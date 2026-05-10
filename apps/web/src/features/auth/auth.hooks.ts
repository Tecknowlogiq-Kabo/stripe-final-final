import { useMutation } from '@tanstack/react-query';
import { authService } from './auth.service';
import type { AuthInput } from './auth.types';

export function useLogin() {
  return useMutation({
    mutationFn: (input: AuthInput) => authService.login(input),
  });
}

export function useRegister() {
  return useMutation({
    mutationFn: (input: AuthInput) => authService.register(input),
  });
}
