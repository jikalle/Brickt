import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface UserState {
  address: string | null;
  isAuthenticated: boolean;
  role: 'owner' | 'investor' | null;
  token: string | null;
}

export const initialUserState: UserState = {
  address: null,
  isAuthenticated: false,
  role: null,
  token: null,
};

const userSlice = createSlice({
  name: 'user',
  initialState: initialUserState,
  reducers: {
    setUser: (
      state,
      action: PayloadAction<{ address: string; role: 'owner' | 'investor'; token: string }>
    ) => {
      state.address = action.payload.address;
      state.isAuthenticated = true;
      state.role = action.payload.role;
      state.token = action.payload.token;
    },
    setWalletAddress: (state, action: PayloadAction<string | null>) => {
      state.address = action.payload;
    },
    clearUser: (state) => {
      state.address = null;
      state.isAuthenticated = false;
      state.role = null;
      state.token = null;
    },
  },
});

export const { setUser, setWalletAddress, clearUser } = userSlice.actions;
export default userSlice.reducer;
