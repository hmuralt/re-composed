import * as React from "react";
import StateProvider, { Unsubscribe } from "../../StateProvider";

export default function withStateToProps<TState, TProps>(
    stateProvider: StateProvider<TState>,
    stateToProps: (state: TState) => TProps
): (Component: React.ComponentType<TProps>) => React.ComponentClass {
    return (Component: React.ComponentType<TProps>) => {
        return class StateToProps extends React.PureComponent<{}, TProps> {
            private unsubscribe: Unsubscribe;

            constructor(props: {}) {
                super(props);
                this.onStateChanged = this.onStateChanged.bind(this);
                this.state = stateToProps(stateProvider.getState());
            }

            public componentDidMount() {
                this.unsubscribe = stateProvider.subscribe(this.onStateChanged);
                this.onStateChanged(stateProvider.getState());
            }

            public render() {
                return (
                    <Component {...this.props} {...this.state} />
                );
            }

            public componentWillUnmount() {
                this.unsubscribe();
            }

            private onStateChanged(state: TState) {
                this.setState(stateToProps(state));
            }
        };
    };
}