# 🐛 버그 수정 보고서: Staging에서 검색 결과가 중복 표시됨

## 버그 정보

| 항목 | 내용 |
|------|------|
| **제목** | [샘플] Staging에서 검색 결과가 중복 표시됨 |
| **심각도** | Medium |
| **우선순위** | P2 |
| **브랜치** | `fix/bug-0fc45bae` |
| **환경** | Staging |

---

## 1. 버그 분석

### 증상
Staging 환경에서 검색 수행 시 동일한 결과가 중복으로 표시됩니다.

### 추정 원인 (Root Cause Analysis)

검색 결과 중복은 일반적으로 다음 원인 중 하나 이상에 해당합니다:

#### 원인 1: API 호출 중복 (가장 유력)
- 컴포넌트가 마운트/언마운트 반복 시 검색 API가 중복 호출됨
- `useEffect` cleanup 함수 미구현 또는 debounce 미적용
- React Strict Mode(개발/Staging)에서 이중 렌더링으로 인한 중복 호출

```javascript
// ❌ 문제 코드 패턴
useEffect(() => {
  fetchSearchResults(query).then(data => {
    setResults(prev => [...prev, ...data]); // 기존 결과에 누적 추가
  });
}, [query]);
```

#### 원인 2: 상태 관리 오류
- 검색 결과를 기존 배열에 누적(`append`)하는 로직이 초기화 없이 실행
- 페이지네이션/무한스크롤 로직에서 중복 페이지 로드

#### 원인 3: 데이터 소스 중복
- 백엔드에서 중복 데이터를 반환 (DB 조인 이슈 등)
- Staging 환경의 데이터 동기화 문제

---

## 2. 권장 수정 방안

### Fix A: API 호출 중복 방지 (프론트엔드)

```javascript
// ✅ 수정 코드
useEffect(() => {
  let cancelled = false;
  
  const search = async () => {
    const data = await fetchSearchResults(query);
    if (!cancelled) {
      setResults(data); // spread가 아닌 교체(replace)
    }
  };
  
  search();
  
  return () => {
    cancelled = true; // cleanup으로 stale 응답 무시
  };
}, [query]);
```

### Fix B: 결과 중복 제거 (방어적 코딩)

```javascript
// ✅ 결과 세팅 시 고유 ID 기반 중복 제거
const setUniqueResults = (newResults) => {
  const uniqueResults = newResults.filter(
    (item, index, self) => 
      index === self.findIndex(t => t.id === item.id)
  );
  setResults(uniqueResults);
};
```

### Fix C: Debounce 적용

```javascript
// ✅ 검색 입력에 debounce 적용
import { useMemo } from 'react';
import debounce from 'lodash/debounce';

const debouncedSearch = useMemo(
  () => debounce((q) => fetchAndSetResults(q), 300),
  []
);

useEffect(() => {
  if (query) {
    debouncedSearch(query);
  }
  return () => debouncedSearch.cancel();
}, [query, debouncedSearch]);
```

---

## 3. 검증 체크리스트

- [ ] Staging 환경에서 검색 시 결과가 중복 없이 표시되는지 확인
- [ ] 빠른 연속 입력(rapid typing) 시에도 중복이 발생하지 않는지 확인
- [ ] 검색어 변경 시 이전 결과가 올바르게 초기화되는지 확인
- [ ] 페이지네이션이 있는 경우, 페이지 전환 시 중복이 없는지 확인
- [ ] Production 환경과 동일한 결과가 반환되는지 비교 확인
- [ ] React Strict Mode 활성화 상태에서도 정상 동작 확인

---

## 4. 추가 조치 필요 사항

> ⚠️ **참고**: 이 버그 리포트에는 실제 대상 파일 경로가 포함되어 있지 않습니다.
> "P2"는 우선순위로 판단되며, 정확한 코드 수정을 위해 아래 정보가 필요합니다:
>
> 1. **검색 기능이 구현된 파일 경로** (예: `src/components/Search.tsx`, `src/hooks/useSearch.ts`)
> 2. **검색 API 엔드포인트** (예: `/api/search`)
> 3. **재현 절차** (Staging URL, 검색 키워드 등)
>
> 위 정보가 제공되면 정확한 코드 수정 PR을 생성할 수 있습니다.

---

*생성일: 2024-01-01 | 브랜치: fix/bug-0fc45bae*
