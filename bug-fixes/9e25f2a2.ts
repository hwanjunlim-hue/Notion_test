// 비밀번호 재설정 링크 검증 함수
async function validatePasswordResetToken(token: string, userId: string): Promise<boolean> {
  try {
    // 1. 토큰이 데이터베이스에 존재하는지 확인
    const resetRecord = await db.passwordResets.findOne({
      token: token,
      userId: userId
    });

    // 2. 토큰이 존재하지 않으면 false 반환
    if (!resetRecord) {
      return false;
    }

    // 3. 토큰 만료 시간 확인 (현재 시간과 비교)
    const now = new Date();
    const expiresAt = new Date(resetRecord.expiresAt);

    if (now > expiresAt) {
      // 만료된 토큰 삭제
      await db.passwordResets.deleteOne({ token: token });
      return false;
    }

    // 4. 토큰이 이미 사용되었는지 확인
    if (resetRecord.isUsed === true) {
      return false;
    }

    return true;
  } catch (error) {
    console.error('Token validation error:', error);
    return false;
  }
}

// 비밀번호 재설정 엔드포인트
async function resetPassword(token: string, userId: string, newPassword: string): Promise<{success: boolean, message: string}> {
  // 1. 토큰 유효성 검증
  const isValidToken = await validatePasswordResetToken(token, userId);

  if (!isValidToken) {
    return {
      success: false,
      message: '유효하지 않거나 만료된 비밀번호 재설정 링크입니다.'
    };
  }

  try {
    // 2. 비밀번호 업데이트
    const hashedPassword = await hashPassword(newPassword);
    await db.users.updateOne(
      { _id: userId },
      { password: hashedPassword }
    );

    // 3. 사용된 토큰 표시 (재사용 방지)
    await db.passwordResets.updateOne(
      { token: token },
      { isUsed: true, usedAt: new Date() }
    );

    // 4. 만료 시간 지난 토큰들 정기적으로 삭제 (선택사항)
    await db.passwordResets.deleteMany({
      expiresAt: { $lt: new Date() }
    });

    return {
      success: true,
      message: '비밀번호가 성공적으로 변경되었습니다.'
    };
  } catch (error) {
    console.error('Password reset error:', error);
    return {
      success: false,
      message: '비밀번호 재설정 중 오류가 발생했습니다.'
    };
  }
}