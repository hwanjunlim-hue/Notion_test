# 사용자 프로필 페이지에서 XSS 취약점 발견

## XSS 취약점 수정 방안

### 1단계: HTML Sanitization 라이브러리 설치
- `npm install dompurify` 또는 `npm install sanitize-html` 설치
- React 환경: `npm install react-html-parser` 고려

### 2단계: 백엔드 입력 검증 추가
javascript
const DOMPurify = require('isomorphic-dompurify');

app.post('/api/profile/update', (req, res) => {
  const sanitizedBio = DOMPurify.sanitize(req.body.bio);
  // DB에 sanitizedBio 저장
});


### 3단계: 프론트엔드 출력 인코딩
javascript
import DOMPurify from 'dompurify';

const ProfilePage = ({ userBio }) => {
  const cleanBio = DOMPurify.sanitize(userBio);
  return <div>{cleanBio}</div>;
};


### 4단계: Content Security Policy(CSP) 헤더 설정

Content-Security-Policy: default-src 'self'; script-src 'self'


### 5단계: dangerouslySetInnerHTML 대체
- React: `dangerouslySetInnerHTML` 제거 후 일반 텍스트 렌더링으로 변경
- 필요 시 안전한 마크다운 라이브러리 사용 (markdown-it + plugin-sanitize)

**Notion:** https://notion.so/c8b0a3fab23642da90bbbaee00be9362