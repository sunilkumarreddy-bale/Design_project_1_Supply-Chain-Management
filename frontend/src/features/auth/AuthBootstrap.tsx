import { useEffect } from 'react';
import { useMeQuery } from '../../api/auth';
import { useAppDispatch, useAppSelector } from '../../app/store';
import { setUser } from './authSlice';

/** Loads the signed-in user's profile whenever there is a token (page reload, login). */
export default function AuthBootstrap() {
  const token = useAppSelector((s) => s.auth.token);
  const dispatch = useAppDispatch();
  const { data } = useMeQuery(undefined, { skip: !token });
  useEffect(() => {
    if (data) dispatch(setUser(data));
  }, [data, dispatch]);
  return null;
}
