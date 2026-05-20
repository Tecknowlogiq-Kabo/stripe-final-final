// Re-export from RTK Query api slice
export { customerKeys } from './customers-keys';
export {
  useMyCustomerQuery as useMyCustomer,
  useCustomerQuery as useCustomer,
  useCreateCustomerMutation as useCreateCustomer,
  useUpdateCustomerMutation as useUpdateCustomer,
} from './customers-api-slice';
