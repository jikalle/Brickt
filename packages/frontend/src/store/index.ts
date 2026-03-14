import { configureStore } from '@reduxjs/toolkit';
import chainReducer from './slices/chainSlice';
import userReducer, { initialUserState, type UserState } from './slices/userSlice';
import propertiesReducer from './slices/propertiesSlice';
import investmentReducer from './slices/investmentSlice';
import tokenReducer from './slices/tokenSlice';

const USER_STORAGE_KEY = 'brickt:user';

const loadUserFromStorage = (): UserState => {
  try {
    if (typeof window === 'undefined') return initialUserState;
    const raw = window.localStorage.getItem(USER_STORAGE_KEY);
    if (!raw) return initialUserState;
    const parsed = JSON.parse(raw) as Partial<UserState>;
    if (!parsed || typeof parsed !== 'object') return initialUserState;
    const address =
      typeof parsed.address === 'string' && parsed.address.trim().length > 0
        ? parsed.address.toLowerCase()
        : null;
    const role = parsed.role === 'owner' || parsed.role === 'investor' ? parsed.role : null;
    const token = typeof parsed.token === 'string' && parsed.token.trim().length > 0 ? parsed.token : null;
    const isAuthenticated = Boolean(token && address && role);
    return {
      address,
      role,
      token,
      isAuthenticated,
    };
  } catch {
    return initialUserState;
  }
};

export const store = configureStore({
  reducer: {
    chain: chainReducer,
    user: userReducer,
    properties: propertiesReducer,
    investment: investmentReducer,
    token: tokenReducer,
  },
  preloadedState: {
    user: loadUserFromStorage(),
  },
});

store.subscribe(() => {
  try {
    if (typeof window === 'undefined') return;
    const user = store.getState().user as UserState;
    const payload = {
      address: user.address,
      role: user.role,
      token: user.token,
    };
    window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore persistence errors
  }
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
