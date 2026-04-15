# 🐛 버그 수정 보고서: Staging에서 검색 결과가 중복 표시됨

## 📋 버그 정보

| 항목 | 내용 |
|------|------|
| **제목** | [샘플] Staging에서 검색 결과가 중복 표시됨 |
| **심각도** | Medium |
| **우선순위** | P2 |
| **브랜치** | `fix/bug-0fc45bae` |
| **환경** | Staging |

---

## 🔍 원인 분석

검색 결과가 중복 표시되는 현상은 일반적으로 다음과 같은 원인에서 발생합니다:

### 1. 상태 관리 중복 누적 (가장 유력)
```typescript
// ❌ 버그 코드 (예시)
const [results, setResults] = useState([]);

useEffect(() => {
  const fetchResults = async () => {
    const data = await searchAPI(query);
    setResults(prev => [...prev, ...data]); // 기존 결과에 계속 누적
  };
  fetchResults();
}, [query]);
```

검색어가 변경될 때마다 이전 결과를 초기화하지 않고 새 결과를 기존 배열에 **append** 하면 중복이 발생합니다.

### 2. useEffect 클린업 미처리 / StrictMode 이중 실행
React 18의 StrictMode에서 개발/스테이징 환경에서는 useEffect가 두 번 실행되어 API를 2회 호출하고, 결과가 두 번 쌓일 수 있습니다.

### 3. API 응답 자체에 중복 데이터 포함
백엔드 쿼리에서 JOIN 등으로 인해 동일 레코드가 여러 번 반환될 수 있습니다.

---

## ✅ 수정 방안

### 방안 A: 상태 초기화 후 덮어쓰기
```typescript
// ✅ 수정 코드
const [results, setResults] = useState([]);

useEffect(() => {
  let cancelled = false;

  const fetchResults = async () => {
    setResults([]); // 검색 시작 시 초기화
    const data = await searchAPI(query);
    if (!cancelled) {
      setResults(data); // spread 누적 대신 완전 교체
    }
  };

  fetchResults();

  return () => {
    cancelled = true; // 클린업으로 race condition 방지
  };
}, [query]);
```

### 방안 B: 결과 중복 제거 (방어적 코드)
```typescript
// ✅ 중복 제거 유틸리티
const deduplicateResults = (results) => {
  const seen = new Set();
  return results.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
};

// 사용
setResults(deduplicateResults(data));
```

### 방안 C: React 18 StrictMode 이중 실행 대응
```typescript
// ✅ AbortController를 활용한 클린업
useEffect(() => {
  const controller = new AbortController();

  const fetchResults = async () => {
    try {
      const data = await searchAPI(query, { signal: controller.signal });
      setResults(data);
    } catch (e) {
      if (e.name !== 'AbortError') throw e;
    }
  };

  fetchResults();

  return () => controller.abort();
}, [query]);
```

---

## 🧪 검증 체크리스트

- [ ] 동일 검색어로 여러 번 검색 시 결과가 중복되지 않는지 확인
- [ ] 검색어 변경 시 이전 결과가 완전히 초기화되는지 확인
- [ ] 빠르게 검색어를 변경할 때 race condition이 발생하지 않는지 확인
- [ ] Staging 환경(React StrictMode)에서 정상 동작하는지 확인
- [ ] 페이지네이션이 있는 경우, 다음 페이지 로드 시 정상 누적되는지 확인
- [ ] 빈 검색어 또는 결과 없음 케이스에서도 정상 표시되는지 확인

---

## 📝 참고사항

- **대상 파일이 레포지토리에서 확인되지 않아** 일반적인 패턴 기반 분석으로 작성되었습니다.
- 실제 코드 파일 경로가 확인되면 해당 파일에 직접 수정을 적용해야 합니다.
- Staging에서만 발생한다면 **React StrictMode 이중 실행**이 가장 유력한 원인입니다.
