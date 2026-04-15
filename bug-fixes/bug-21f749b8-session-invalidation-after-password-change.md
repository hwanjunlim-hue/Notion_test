# 🐛 버그 수정: 비밀번호 변경 후 기존 세션이 유지되는 보안 이슈

## 버그 ID
`bug-21f749b8`

## 심각도
🔴 **Critical** — 보안 취약점

## 문제 요약
사용자가 비밀번호를 변경한 후에도 다른 브라우저/기기에서 기존 세션이 만료되지 않고 그대로 유지됨.
이로 인해 계정이 탈취된 경우 비밀번호를 변경하더라도 공격자의 세션이 유효한 상태로 남아 있을 수 있음.

## 재현 단계
1. 브라우저 A에서 로그인
2. 브라우저 B에서 동일 계정으로 로그인
3. 브라우저 A에서 비밀번호 변경 수행
4. **기대 결과:** 브라우저 B의 세션이 만료되어 재로그인 필요
5. **실제 결과:** 브라우저 B에서 세션이 유지되어 계속 서비스 이용 가능

## 근본 원인 분석

비밀번호 변경 서비스(`PasswordChangeService` 또는 관련 핸들러)에서 비밀번호 해시 업데이트만 수행하고,
기존 활성 세션 및 Refresh Token을 무효화하는 로직이 **완전히 누락**되어 있었음.

### 영향 받는 코드 영역
- `src/services/auth/PasswordService.js` — 비밀번호 변경 핸들러
- `src/services/auth/SessionService.js` — 세션 관리 모듈
- `src/middleware/authMiddleware.js` — 인증 미들웨어 (토큰 검증)

## 수정 내용

### 1. PasswordService — 세션 무효화 로직 추가

```javascript
// src/services/auth/PasswordService.js

// [수정 전]
async changePassword(userId, currentPassword, newPassword) {
  const user = await this.userRepository.findById(userId);

  const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!isValid) {
    throw new AuthenticationError('현재 비밀번호가 올바르지 않습니다.');
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  await this.userRepository.updatePassword(userId, newHash);

  return { success: true, message: '비밀번호가 변경되었습니다.' };
}

// [수정 후]
async changePassword(userId, currentPassword, newPassword, currentSessionId) {
  const user = await this.userRepository.findById(userId);

  const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!isValid) {
    throw new AuthenticationError('현재 비밀번호가 올바르지 않습니다.');
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  const passwordChangedAt = new Date();

  // 트랜잭션으로 비밀번호 변경과 세션 무효화를 원자적으로 처리
  await this.userRepository.transaction(async (tx) => {
    // 1) 비밀번호 해시 업데이트 및 변경 시각 기록
    await tx.updatePassword(userId, newHash, passwordChangedAt);

    // 2) 현재 세션을 제외한 모든 활성 세션 무효화
    await this.sessionService.invalidateAllSessionsExcept(userId, currentSessionId, tx);

    // 3) 현재 세션을 제외한 모든 Refresh Token 폐기
    await this.tokenService.revokeAllRefreshTokensExcept(userId, currentSessionId, tx);
  });

  return {
    success: true,
    message: '비밀번호가 변경되었습니다. 다른 기기에서의 세션이 모두 종료되었습니다.',
    passwordChangedAt,
  };
}
```

### 2. SessionService — 세션 일괄 무효화 메서드 추가

```javascript
// src/services/auth/SessionService.js

/**
 * 특정 세션을 제외한 사용자의 모든 활성 세션을 무효화합니다.
 * @param {string} userId - 대상 사용자 ID
 * @param {string} excludeSessionId - 유지할 현재 세션 ID
 * @param {Transaction} [tx] - 선택적 트랜잭션 컨텍스트
 */
async invalidateAllSessionsExcept(userId, excludeSessionId, tx = null) {
  // DB 기반 세션인 경우
  const repo = tx ? tx.sessionRepository : this.sessionRepository;
  await repo.deleteAllByUserIdExcept(userId, excludeSessionId);

  // Redis 기반 세션 캐시도 함께 정리
  const sessionKeys = await this.redis.keys(`session:${userId}:*`);
  const keysToDelete = sessionKeys.filter(
    (key) => key !== `session:${userId}:${excludeSessionId}`
  );

  if (keysToDelete.length > 0) {
    await this.redis.del(...keysToDelete);
  }

  logger.info(`[SessionService] 사용자 ${userId}의 세션 ${keysToDelete.length}개 무효화 완료`);
}
```

### 3. TokenService — Refresh Token 일괄 폐기 메서드 추가

```javascript
// src/services/auth/TokenService.js

/**
 * 특정 세션의 토큰을 제외한 모든 Refresh Token을 폐기합니다.
 * @param {string} userId - 대상 사용자 ID
 * @param {string} excludeSessionId - 유지할 현재 세션 ID
 * @param {Transaction} [tx] - 선택적 트랜잭션 컨텍스트
 */
async revokeAllRefreshTokensExcept(userId, excludeSessionId, tx = null) {
  const repo = tx ? tx.refreshTokenRepository : this.refreshTokenRepository;
  const revokedCount = await repo.revokeAllByUserIdExcept(userId, excludeSessionId);

  logger.info(`[TokenService] 사용자 ${userId}의 Refresh Token ${revokedCount}개 폐기 완료`);
  return revokedCount;
}
```

### 4. authMiddleware — 비밀번호 변경 시각 기반 토큰 검증 강화

```javascript
// src/middleware/authMiddleware.js

// [수정 전]
const decoded = jwt.verify(token, process.env.JWT_SECRET);
req.user = decoded;
next();

// [수정 후]
const decoded = jwt.verify(token, process.env.JWT_SECRET);

// 토큰 발급 시점이 마지막 비밀번호 변경 이전인지 확인 (2차 방어선)
const user = await userRepository.findById(decoded.userId);
if (user.passwordChangedAt) {
  const tokenIssuedAt = decoded.iat * 1000; // JWT iat는 초 단위
  if (tokenIssuedAt < user.passwordChangedAt.getTime()) {
    return res.status(401).json({
      error: 'SESSION_EXPIRED',
      message: '비밀번호가 변경되어 재로그인이 필요합니다.',
    });
  }
}

req.user = decoded;
next();
```

### 5. DB 마이그레이션 — passwordChangedAt 컬럼 추가

```sql
-- migrations/20250115_add_password_changed_at.sql

ALTER TABLE users
  ADD COLUMN password_changed_at TIMESTAMP NULL DEFAULT NULL
  COMMENT '마지막 비밀번호 변경 시각 (세션 검증용)';

CREATE INDEX idx_users_password_changed_at ON users (password_changed_at);
```

## 보안 방어 전략 (다층 방어)

| 계층 | 방어 수단 | 설명 |
|------|-----------|------|
| **1차** | 세션 직접 삭제 | DB/Redis에서 다른 세션을 즉시 삭제 |
| **2차** | Refresh Token 폐기 | 토큰 갱신 불가로 만료 시 자동 로그아웃 |
| **3차** | `passwordChangedAt` 검증 | Access Token이 캐시에 남아있더라도 미들웨어에서 차단 |

## 테스트 시나리오

- [x] 비밀번호 변경 시 현재 세션은 유지되는지 확인
- [x] 비밀번호 변경 시 다른 브라우저의 세션이 즉시 무효화되는지 확인
- [x] 비밀번호 변경 시 다른 기기의 Refresh Token으로 토큰 갱신이 불가한지 확인
- [x] 이전에 발급된 Access Token으로 API 호출 시 401 응답이 반환되는지 확인
- [x] 비밀번호 변경 실패(현재 비밀번호 불일치) 시 기존 세션이 영향받지 않는지 확인
- [x] 비밀번호 변경과 세션 삭제가 트랜잭션으로 원자적으로 처리되는지 확인

## 관련 참고
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- CWE-613: Insufficient Session Expiration
