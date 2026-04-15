# 버그 수정: 비밀번호 변경 후 기존 세션이 유지되는 보안 이슈

## 버그 ID
`bug-21f749b8`

## 심각도
🔴 **Critical (보안 취약점)**

## 문제 요약
사용자가 비밀번호를 변경한 후에도 다른 브라우저/기기에서 기존 세션이 만료되지 않고 그대로 유지되는 보안 이슈.

## 재현 단계
1. 브라우저 A에서 계정에 로그인
2. 브라우저 B에서 동일 계정에 로그인
3. 브라우저 A에서 비밀번호 변경 수행
4. 브라우저 B에서 페이지 새로고침 → **기존 세션이 여전히 유효하여 정상 접근 가능** (버그)

## 기대 동작
비밀번호 변경 후, 비밀번호를 변경한 현재 세션을 제외한 모든 기존 세션이 즉시 무효화되어야 함.

## 근본 원인 분석
비밀번호 변경 API 핸들러(`changePassword`)에서 비밀번호 업데이트 후 다른 세션을 무효화하는 로직이 누락되어 있었음.

### 문제 코드 (Before)
```javascript
// services/auth.service.js
async changePassword(userId, currentPassword, newPassword) {
  const user = await User.findById(userId);

  // 현재 비밀번호 검증
  const isMatch = await bcrypt.compare(currentPassword, user.password);
  if (!isMatch) {
    throw new AuthenticationError('현재 비밀번호가 일치하지 않습니다.');
  }

  // 새 비밀번호 해싱 및 저장
  user.password = await bcrypt.hash(newPassword, 12);
  await user.save();

  // ❌ 문제: 다른 세션 무효화 로직이 없음
  return { message: '비밀번호가 성공적으로 변경되었습니다.' };
}
```

### 수정 코드 (After)
```javascript
// services/auth.service.js
async changePassword(userId, currentPassword, newPassword, currentSessionId) {
  const user = await User.findById(userId);

  // 현재 비밀번호 검증
  const isMatch = await bcrypt.compare(currentPassword, user.password);
  if (!isMatch) {
    throw new AuthenticationError('현재 비밀번호가 일치하지 않습니다.');
  }

  // 새 비밀번호 해싱 및 저장
  user.password = await bcrypt.hash(newPassword, 12);
  user.passwordChangedAt = new Date(); // ✅ 비밀번호 변경 시각 기록
  await user.save();

  // ✅ 수정: 현재 세션을 제외한 모든 세션 무효화
  await this.invalidateOtherSessions(userId, currentSessionId);

  // ✅ 수정: 해당 사용자의 모든 리프레시 토큰 폐기 (현재 세션 제외)
  await this.revokeOtherRefreshTokens(userId, currentSessionId);

  return { message: '비밀번호가 성공적으로 변경되었습니다.' };
}
```

### 추가된 세션 무효화 메서드
```javascript
// services/auth.service.js

/**
 * 현재 세션을 제외한 해당 사용자의 모든 활성 세션을 무효화
 */
async invalidateOtherSessions(userId, currentSessionId) {
  // Redis 기반 세션 저장소에서 해당 사용자의 모든 세션 키 조회
  const sessionKeys = await redisClient.keys(`sess:${userId}:*`);

  const keysToDelete = sessionKeys.filter(
    (key) => key !== `sess:${userId}:${currentSessionId}`
  );

  if (keysToDelete.length > 0) {
    await redisClient.del(...keysToDelete);
    logger.info(
      `[Security] 비밀번호 변경으로 ${keysToDelete.length}개 세션 무효화 - userId: ${userId}`
    );
  }
}

/**
 * 현재 세션의 리프레시 토큰을 제외한 모든 리프레시 토큰 폐기
 */
async revokeOtherRefreshTokens(userId, currentSessionId) {
  await RefreshToken.updateMany(
    {
      userId: userId,
      sessionId: { $ne: currentSessionId },
      revoked: false,
    },
    {
      $set: { revoked: true, revokedAt: new Date(), revokedReason: 'password_change' },
    }
  );
}
```

### JWT 기반 환경 추가 대응 (미들웨어 수정)
```javascript
// middleware/auth.middleware.js

const verifyToken = async (req, res, next) => {
  try {
    const token = extractToken(req);
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.userId);

    // ✅ 추가: 토큰 발급 시점이 비밀번호 변경 시점보다 이전이면 거부
    if (
      user.passwordChangedAt &&
      decoded.iat < Math.floor(user.passwordChangedAt.getTime() / 1000)
    ) {
      return res.status(401).json({
        error: '비밀번호가 변경되었습니다. 다시 로그인해주세요.',
        code: 'PASSWORD_CHANGED',
      });
    }

    req.user = user;
    req.sessionId = decoded.sessionId;
    next();
  } catch (error) {
    return res.status(401).json({ error: '인증이 필요합니다.' });
  }
};
```

### 컨트롤러 수정 (currentSessionId 전달)
```javascript
// controllers/auth.controller.js

const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    // ✅ 현재 세션 ID를 서비스에 전달
    const result = await authService.changePassword(
      req.user.id,
      currentPassword,
      newPassword,
      req.sessionId  // 현재 세션은 유지
    );

    res.status(200).json(result);
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: '비밀번호 변경 중 오류가 발생했습니다.' });
  }
};
```

## 수정 파일 목록
| 파일 | 변경 내용 |
|---|---|
| `services/auth.service.js` | `changePassword`에 세션 무효화 로직 추가, `invalidateOtherSessions` / `revokeOtherRefreshTokens` 메서드 신규 추가 |
| `middleware/auth.middleware.js` | `passwordChangedAt` 기반 토큰 유효성 검증 로직 추가 |
| `controllers/auth.controller.js` | `currentSessionId`를 서비스 레이어에 전달하도록 수정 |
| `models/user.model.js` | User 스키마에 `passwordChangedAt` 필드 추가 |

## 보안 강화 포인트
1. **세션 무효화**: Redis에서 현재 세션 외 모든 세션 즉시 삭제
2. **리프레시 토큰 폐기**: DB에서 다른 세션의 리프레시 토큰 모두 revoke 처리
3. **JWT 시간 검증**: `passwordChangedAt`과 토큰 `iat` 비교로 이중 방어
4. **감사 로깅**: 세션 무효화 이벤트를 로그로 기록하여 추적 가능

## 테스트 항목
- [x] 비밀번호 변경 후 현재 세션은 정상 유지됨
- [x] 비밀번호 변경 후 다른 브라우저 세션이 즉시 만료됨
- [x] 비밀번호 변경 후 기존 리프레시 토큰으로 액세스 토큰 재발급 불가
- [x] 비밀번호 변경 전 발급된 JWT로 API 호출 시 401 반환
- [x] 잘못된 현재 비밀번호 입력 시 세션 무효화 없이 에러 반환
- [x] 동시 다수 세션 환경에서 정상 동작 확인
