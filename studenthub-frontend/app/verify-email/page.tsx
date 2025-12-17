'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { verifyEmail, resendVerification } from '@/store/slices/authSlice';
import Link from 'next/link';

const verifyEmailSchema = z.object({
  code: z.string().length(6, 'Код должен содержать 6 символов'),
});

type VerifyEmailFormData = z.infer<typeof verifyEmailSchema>;

export default function VerifyEmailPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const dispatch = useAppDispatch();
  const { isLoading, error } = useAppSelector((state) => state.auth);
  const [email, setEmail] = useState('');
  const [resendSuccess, setResendSuccess] = useState(false);

  const {
    register: registerField,
    handleSubmit,
    formState: { errors },
  } = useForm<VerifyEmailFormData>({
    resolver: zodResolver(verifyEmailSchema),
  });

  useEffect(() => {
    const emailParam = searchParams.get('email');
    if (emailParam) {
      setEmail(emailParam);
    } else {
      router.push('/register');
    }
  }, [searchParams, router]);

  const onSubmit = async (data: VerifyEmailFormData) => {
    try {
      const result = await dispatch(verifyEmail({ email, code: data.code }));
      if (verifyEmail.fulfilled.match(result)) {
        router.push('/login?verified=true');
      }
    } catch (err) {
      console.error('Verification error:', err);
    }
  };

  const handleResend = async () => {
    try {
      await dispatch(resendVerification(email));
      setResendSuccess(true);
      setTimeout(() => setResendSuccess(false), 5000);
    } catch (err) {
      console.error('Resend error:', err);
    }
  };

  if (!email) {
    return null;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 px-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Подтвердите email</h1>
          <p className="text-gray-600">
            Мы отправили код подтверждения на <strong>{email}</strong>
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          {resendSuccess && (
            <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">
              Код отправлен повторно!
            </div>
          )}

          <div>
            <label htmlFor="code" className="block text-sm font-medium text-gray-700 mb-2">
              Код подтверждения
            </label>
            <input
              id="code"
              type="text"
              {...registerField('code')}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition text-center text-2xl tracking-widest"
              placeholder="000000"
              maxLength={6}
            />
            {errors.code && (
              <p className="mt-1 text-sm text-red-600">{errors.code.message}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-primary-600 text-white py-3 rounded-lg font-medium hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {isLoading ? 'Проверка...' : 'Подтвердить'}
          </button>
        </form>

        <div className="mt-6 text-center space-y-3">
          <button
            type="button"
            onClick={handleResend}
            className="text-sm text-primary-600 hover:text-primary-700 font-medium"
          >
            Отправить код повторно
          </button>
          <div>
            <Link href="/login" className="text-sm text-gray-600 hover:text-gray-700">
              Вернуться к входу
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}


