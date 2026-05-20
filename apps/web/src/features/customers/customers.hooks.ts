// Re-export from RTK Query api slice
// Tag-based cache invalidation replaces the old queryClient.invalidateQueries calls.

export { customerKeys } from './customers-keys';
export {
  useMyCustomerQuery as useMyCustomer,
  useCustomerQuery as useCustomer,
  useCreateCustomerMutation as useCreateCustomer,
  useUpdateCustomerMutation as useUpdateCustomer,
} from './customers-api-slice';
