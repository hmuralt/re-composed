import { Reducer, combineReducers, Action, ReducersMapObject } from "redux";
import { Observable, BehaviorSubject } from "rxjs";
import { filter, map, distinctUntilChanged, takeUntil, scan } from "rxjs/operators";
import * as shallowEqual from "shallowequal";
import { withRoute } from "./RouteAction";
import RoutingOption from "./RoutingOption";
import { withRouteReducer } from "./ReducerHelpers";
import { Hub, StateReportType, StateReportNotification } from "./Hub";
import { Destructible } from "./Destructible";
import updateReducers from "./UpdateReducers";
import StateProvider from "./StateProvider";

export interface StateContext<TState, TActionType> extends StateProvider<TState>, Destructible {
  id: string;
  dispatch<TAction extends Action<TActionType>>(action: TAction, isRoutedToThisContext?: boolean): void;
}

export interface StateBuildingBlock<TState, TReducerActionType> {
  key: string;
  stateKey: string;
  defaultState: TState;
  reducer?: Reducer<Readonly<TState>, Action<TReducerActionType>>;
  routingOptions?: Map<TReducerActionType, RoutingOption>;
  parentContextId: string;
}

interface BaseObservables {
  reducers$: Observable<ReducersMapObject>;
  contextState$: Observable<{}>;
  isDestroyed$: Observable<boolean>;
}

export function createStateContext<TState, TActionType, TReducerActionType>(
  stateBuildingBlock: StateBuildingBlock<TState, TReducerActionType>,
  hub: Hub
): StateContext<TState, TActionType> {
  const id = `${stateBuildingBlock.parentContextId}.${stateBuildingBlock.key}`;
  const setupFuntions = getScopedSetupFunctions<TState, TActionType, TReducerActionType>(stateBuildingBlock, hub);

  const destroy = setupFuntions.createDestroy(id);
  const dispatch = setupFuntions.createDispatch(id);
  const baseObservables = setupFuntions.createBaseObservables(id);
  const stateSubject = setupFuntions.createStateSubject(baseObservables);

  setupFuntions.setupSelfDestructionOnParentsDestruction(destroy, baseObservables.isDestroyed$);
  setupFuntions.setupStateRegistrationPublishing(baseObservables);
  setupFuntions.setupStatePublishing(id, baseObservables);
  setupFuntions.setupActionDispatching(id, baseObservables.isDestroyed$);
  setupFuntions.publishStateRegistration(id);

  return {
    id,
    get state() {
      return stateSubject.getValue();
    },
    state$: stateSubject.asObservable(),
    dispatch,
    destroy
  };
}

function getScopedSetupFunctions<TState, TActionType, TReducerActionType>(
  stateBuildingBlock: StateBuildingBlock<TState, TReducerActionType>,
  hub: Hub
) {
  const { key, defaultState, stateKey, parentContextId, reducer, routingOptions } = stateBuildingBlock;
  const { dispatchingActionPublisher, destructionPublisher, stateReportPublisher, statePublisher } = hub;

  return {
    createDestroy(contextId: string) {
      return () => {
        stateReportPublisher.publish({
          type: StateReportType.Deregistration,
          parentContextId: parentContextId,
          key
        });

        destructionPublisher.publish({
          contextId
        });
      };
    },

    createIsDestroyed$(contextId: string) {
      return destructionPublisher.notification$.pipe(
        filter((notification) => notification.contextId === contextId),
        map(() => true)
      );
    },

    createDispatch(contextId: string) {
      return (action: Action<TActionType>, isRoutedToThisContext = false) => {
        const actionToDispatch = isRoutedToThisContext ? withRoute(contextId, action) : action;

        dispatchingActionPublisher.publish({
          parentContextId: parentContextId,
          action: actionToDispatch
        });
      };
    },

    createBaseObservables(contextId: string): BaseObservables {
      const reducers$ = this.createReducers$(contextId);
      const contextState$ = this.createContextState$();
      const isDestroyed$ = this.createIsDestroyed$(contextId);

      return {
        reducers$,
        contextState$,
        isDestroyed$
      };
    },

    createReducers$(contextId: string) {
      return stateReportPublisher.notification$.pipe(
        filter((notification) => notification.parentContextId === contextId),
        scan<StateReportNotification, ReducersMapObject>((reducers, notification) => {
          return updateReducers(reducers, notification);
        }, {})
      );
    },

    createContextState$() {
      return statePublisher.notification$.pipe(
        filter((notification) => notification.contextId === parentContextId),
        map((notification) => notification.state[key] as {})
      );
    },

    setupSelfDestructionOnParentsDestruction(destroy: () => void, isDestroyed$: Observable<boolean>) {
      destructionPublisher.notification$
        .pipe(
          filter((notification) => notification.contextId === parentContextId),
          takeUntil(isDestroyed$)
        )
        .subscribe(() => {
          destroy();
        });
    },

    setupStateRegistrationPublishing(baseObservables: BaseObservables) {
      baseObservables.reducers$.pipe(takeUntil(baseObservables.isDestroyed$)).subscribe((reducers) => {
        const stateContextReducer = Object.keys(reducers).length > 0 ? combineReducers(reducers) : undefined;

        stateReportPublisher.publish({
          type: StateReportType.Registration,
          parentContextId: parentContextId,
          key,
          reducer: stateContextReducer
        });
      });
    },

    setupStatePublishing(contextId: string, baseObservables: BaseObservables) {
      baseObservables.contextState$.pipe(takeUntil(baseObservables.isDestroyed$)).subscribe((contextState) => {
        if (contextState === undefined) {
          return;
        }

        const keys = Object.keys(contextState);
        const isSingleLevelStateOnly = keys.length === 0 || (keys.length === 1 && keys[0] === stateKey);
        if (isSingleLevelStateOnly) {
          return;
        }

        statePublisher.publish({
          contextId,
          state: contextState
        });
      });
    },

    createStateSubject(baseObservables: BaseObservables) {
      const stateSubject = new BehaviorSubject(defaultState);

      baseObservables.contextState$
        .pipe(
          map((contextState) => {
            let state;

            if (contextState === undefined) {
              state = defaultState;
            } else if (contextState[stateKey] === undefined) {
              state = contextState;
            } else {
              state = contextState[stateKey];
            }

            return state;
          }),
          distinctUntilChanged(shallowEqual),
          takeUntil(baseObservables.isDestroyed$)
        )
        .subscribe(stateSubject);
      return stateSubject;
    },

    setupActionDispatching(contextId: string, isDestroyed$: Observable<boolean>) {
      dispatchingActionPublisher.notification$
        .pipe(
          filter((notification) => notification.parentContextId === contextId),
          takeUntil(isDestroyed$)
        )
        .subscribe(({ action }) => {
          dispatchingActionPublisher.publish({
            parentContextId: parentContextId,
            action
          });
        });
    },

    publishStateRegistration(contextId: string) {
      let finalReducer;

      if (reducer !== undefined) {
        finalReducer = routingOptions !== undefined ? withRouteReducer(contextId, reducer, routingOptions) : reducer;
      }

      stateReportPublisher.publish({
        type: StateReportType.Registration,
        parentContextId: contextId,
        key: stateKey,
        reducer: finalReducer
      });
    }
  };
}
