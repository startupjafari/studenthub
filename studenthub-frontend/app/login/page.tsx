'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { login, clearError } from '@/store/slices/authSlice';
import Link from 'next/link';

const loginSchema = z.object({
  email: z.string().email('Введите корректный email адрес'),
  password: z.string().min(1, 'Введите пароль'),
  twoFactorCode: z.string().optional(),
});

type LoginFormData = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const { isLoading, error, isAuthenticated, requiresTwoFactor } = useAppSelector(
    (state) => state.auth
  );
  const [showTwoFactor, setShowTwoFactor] = useState(false);

  const {
    register: registerField,
    handleSubmit,
    formState: { errors },
    setValue,
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  useEffect(() => {
    if (isAuthenticated) {
      router.push('/dashboard');
    }
  }, [isAuthenticated, router]);

  useEffect(() => {
    if (requiresTwoFactor) {
      setShowTwoFactor(true);
    }
  }, [requiresTwoFactor]);

  useEffect(() => {
    return () => {
      dispatch(clearError());
    };
  }, [dispatch]);

  const onSubmit = async (data: LoginFormData) => {
    try {
      const result = await dispatch(login(data));
      if (login.fulfilled.match(result)) {
        if ('requiresTwoFactor' in result.payload && result.payload.requiresTwoFactor) {
          setShowTwoFactor(true);
        } else {
          router.push('/dashboard');
        }
      }
    } catch (err) {
      console.error('Login error:', err);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 px-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">StudentHub</h1>
          <h2 className="text-xl text-gray-600">Войдите в аккаунт</h2>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
              Email
            </label>
            <input
              id="email"
              type="email"
              {...registerField('email')}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition"
              placeholder="student@university.edu"
              disabled={showTwoFactor}
            />
            {errors.email && (
              <p className="mt-1 text-sm text-red-600">{errors.email.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
              Пароль
            </label>
            <input
              id="password"
              type="password"
              {...registerField('password')}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition"
              placeholder="Введите пароль"
              disabled={showTwoFactor}
            />
            {errors.password && (
              <p className="mt-1 text-sm text-red-600">{errors.password.message}</p>
            )}
          </div>

          {showTwoFactor && (
            <div>
              <label
                htmlFor="twoFactorCode"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Код двухфакторной аутентификации
              </label>
              <input
                id="twoFactorCode"
                type="text"
                {...registerField('twoFactorCode')}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition"
                placeholder="000000"
                maxLength={6}
              />
              {errors.twoFactorCode && (
                <p className="mt-1 text-sm text-red-600">{errors.twoFactorCode.message}</p>
              )}
              <button
                type="button"
                onClick={() => {
                  setShowTwoFactor(false);
                  setValue('twoFactorCode', '');
                }}
                className="mt-2 text-sm text-primary-600 hover:text-primary-700"
              >
                Отменить
              </button>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-primary-600 text-white py-3 rounded-lg font-medium hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {isLoading ? 'Вход...' : showTwoFactor ? 'Подтвердить' : 'Войти'}
          </button>
        </form>

        <div className="mt-6 space-y-3">
          <div className="text-center">
            <Link
              href="/forgot-password"
              className="text-sm text-primary-600 hover:text-primary-700 font-medium"
            >
              Забыли пароль?
            </Link>
          </div>
          <div className="text-center">
            <p className="text-sm text-gray-600">
              Нет аккаунта?{' '}
              <Link href="/register" className="text-primary-600 hover:text-primary-700 font-medium">
                Зарегистрироваться
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}


