// 비밀번호 변경 후 모든 세션 무효화

import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { User } from './models/User';
import { Session } from './models/Session';

// 비밀번호 변경 함수
async function changePassword(req: Request, res: Response) {
  try {
    const userId = req.user.id;
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(userId);

    // 현재 비밀번호 검증
    const isValidPassword = await user.comparePassword(currentPassword);
    if (!isValidPassword) {
      return res.status(401).json({ error: '현재 비밀번호가 일치하지 않습니다' });
    }

    // 새로운 비밀번호로 업데이트
    user.password = newPassword;
    user.passwordChangedAt = new Date(); // 비밀번호 변경 타임스탬프 설정
    await user.save();

    // 핵심 수정: 해당 사용자의 모든 세션 무효화
    await Session.deleteMany({ userId: userId });
    
    // 모든 토큰 블랙리스트 처리 (옵션)
    await invalidateAllTokensForUser(userId);

    // 현재 세션 로그아웃
    res.clearCookie('sessionId');
    res.clearCookie('token');

    return res.status(200).json({
      message: '비밀번호가 변경되었습니다. 모든 활성 세션이 로그아웃되었습니다. 다시 로그인해주세요.',
      requiresRelogin: true
    });
  } catch (error) {
    console.error('비밀번호 변경 오류:', error);
    return res.status(500).json({ error: '비밀번호 변경 중 오류 발생' });
  }
}

// 토큰 블랙리스트 함수
async function invalidateAllTokensForUser(userId: string) {
  const tokenBlacklist = new Map();
  const key = `user_${userId}_tokens`;
  tokenBlacklist.set(key, new Date());
  // Redis 또는 DB에 저장
}

// 미들웨어: 비밀번호 변경 후 토큰 검증
function validateTokenAfterPasswordChange(req: Request, res: Response, next: Function) {
  const token = req.headers.authorization?.split(' ')[1];
  const user = req.user;
  
  if (token && user && user.passwordChangedAt) {
    // 토큰 발급 시간과 비밀번호 변경 시간 비교
    const tokenIssuedAt = new Date(user.iat * 1000);
    if (tokenIssuedAt < user.passwordChangedAt) {
      return res.status(401).json({ error: '비밀번호 변경으로 인해 재로그인이 필요합니다' });
    }
  }
  next();
}

export { changePassword, validateTokenAfterPasswordChange };