// Re-export from RTK Query api slice
// Auth uses raw fetch (not apiClient) to receive Set-Cookie headers directly.
export { useLoginMutation as useLogin, useRegisterMutation as useRegister } from './auth-api-slice';
