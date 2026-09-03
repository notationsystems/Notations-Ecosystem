import { applyMiddleware, combineReducers, createStore, type Middleware, type StoreEnhancer } from 'redux';
import { keplerGlReducer, enhanceReduxMiddleware } from '@kepler.gl/reducers';

// Redux is used only for Kepler.gl (it requires it). Dock state lives in React state.
const reducer = combineReducers({
  keplerGl: keplerGlReducer.initialState({
    uiState: { readOnly: false, currentModal: null, activeSidePanel: null },
    mapStyle: { styleType: 'dark-matter' },
  }),
});

const middlewares = enhanceReduxMiddleware([]) as unknown as Middleware[];
const enhancer = applyMiddleware(...middlewares) as unknown as StoreEnhancer;

export const store = createStore(reducer, {}, enhancer);
export type RootState = ReturnType<typeof reducer>;
