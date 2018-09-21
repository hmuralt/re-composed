import * as React from "react";
import StateProvider, { Unsubscribe } from "../../StateProvider";

export default function withStateToProps<TState, TProps, TOwnProps = {}>(
    stateProvider: StateProvider<TState>,
    stateToProps: (state: TState, ownProps: TOwnProps) => TProps
): (Component: React.ComponentType<TProps>) => React.ComponentClass {
    return (Component: React.ComponentType<TProps>) => {
        return class StateToProps extends React.PureComponent<TOwnProps, TState> {
            private unsubscribe: Unsubscribe;

            constructor(props: TOwnProps) {
                super(props);
                this.onStateChanged = this.onStateChanged.bind(this);
                this.state = stateProvider.getState();
            }

            public componentDidMount() {
                this.unsubscribe = stateProvider.subscribe(this.onStateChanged);
                this.onStateChanged(stateProvider.getState());
            }

            public render() {
                const innerProps = stateToProps(this.state, this.props);
                return (
                    <Component {...innerProps} />
                );
            }

            public componentWillUnmount() {
                this.unsubscribe();
            }

            private onStateChanged(state: TState) {
                this.setState(state);
            }
        };
    };
}