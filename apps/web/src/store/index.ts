import { configureStore } from '@reduxjs/toolkit';
import { baseApi } from './baseApi';

// Trigger endpoint registrations by importing the slices
import './apis/customersApi';
import './apis/paymentMethodsApi';
import './apis/subscriptionsApi';

export const store = configureStore({
  reducer: {
    [baseApi.reducerPath]: baseApi.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(baseApi.middleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
