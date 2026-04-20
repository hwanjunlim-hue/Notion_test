# 🐛 Bug Fix Report: bug-062d1e33

## 버그 정보

| 항목 | 내용 |
|------|------|
| **제목** | [샘플] 모바일에서 이미지 첨부 시 앱 크래시 |
| **심각도** | Critical |
| **우선순위** | P0 |
| **브랜치** | `fix/bug-062d1e33` |

---

## 1. 버그 분석

### 증상
모바일 환경에서 이미지를 첨부할 때 앱이 크래시(강제 종료)됩니다.

### 추정 원인 분석

#### 원인 1: 메모리 부족 (OOM - Out of Memory)
- 모바일 디바이스는 데스크톱 대비 가용 메모리가 제한적임
- 고해상도 이미지를 리사이징 없이 원본 그대로 메모리에 로드할 경우 OOM 크래시 발생 가능
- 특히 카메라로 촬영한 이미지는 10MB 이상인 경우가 많음

#### 원인 2: Null/Undefined 참조
- 이미지 첨부 과정에서 파일 객체나 URI가 `null`/`undefined`인 경우 핸들링 부재
- 모바일 브라우저/WebView에서 파일 선택 취소 시 반환값이 플랫폼마다 상이

#### 원인 3: MIME 타입 / 파일 형식 검증 누락
- HEIC/HEIF (iOS) 등 모바일 전용 이미지 포맷에 대한 처리가 없을 경우 파싱 실패
- 지원하지 않는 파일 형식에 대한 예외 처리 부재

#### 원인 4: 비동기 처리 오류
- 이미지 리사이징/압축 비동기 로직에서 Promise rejection 미처리
- 컴포넌트 언마운트 후 상태 업데이트 시도 (메모리 누수 → 크래시)

---

## 2. 수정 방안

### 🔧 수정 1: 이미지 리사이징 및 압축 적용

```typescript
// 수정 전 (추정)
const handleImageAttach = async (file: File) => {
  const formData = new FormData();
  formData.append('image', file); // 원본 이미지를 그대로 업로드
  await uploadImage(formData);
};

// 수정 후
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_IMAGE_DIMENSION = 2048; // px

const compressImage = async (file: File): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let { width, height } = img;

      if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
        const ratio = Math.min(MAX_IMAGE_DIMENSION / width, MAX_IMAGE_DIMENSION / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('이미지 압축에 실패했습니다.'));
        },
        'image/jpeg',
        0.8
      );
    };
    img.onerror = () => reject(new Error('이미지를 로드할 수 없습니다.'));
    img.src = URL.createObjectURL(file);
  });
};

const handleImageAttach = async (file: File) => {
  try {
    const processedImage = file.size > MAX_IMAGE_SIZE
      ? await compressImage(file)
      : file;

    const formData = new FormData();
    formData.append('image', processedImage, file.name);
    await uploadImage(formData);
  } catch (error) {
    console.error('이미지 첨부 오류:', error);
    showErrorToast('이미지 첨부에 실패했습니다. 다시 시도해주세요.');
  }
};
```

### 🔧 수정 2: Null Safety 및 파일 검증 추가

```typescript
// 수정 전 (추정)
const onFileSelected = (event: ChangeEvent<HTMLInputElement>) => {
  const file = event.target.files[0]; // files가 null일 경우 크래시
  processImage(file);
};

// 수정 후
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif'];
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

const onFileSelected = (event: ChangeEvent<HTMLInputElement>) => {
  const files = event.target.files;

  if (!files || files.length === 0) {
    console.warn('파일이 선택되지 않았습니다.');
    return;
  }

  const file = files[0];

  if (!file || !file.type) {
    showErrorToast('유효하지 않은 파일입니다.');
    return;
  }

  if (!ALLOWED_IMAGE_TYPES.includes(file.type.toLowerCase())) {
    showErrorToast(`지원하지 않는 이미지 형식입니다: ${file.type}`);
    return;
  }

  if (file.size > MAX_FILE_SIZE) {
    showErrorToast('파일 크기가 20MB를 초과합니다.');
    return;
  }

  processImage(file);
};
```

### 🔧 수정 3: 비동기 처리 안전장치

```typescript
// 수정 후 - 컴포넌트 내부
useEffect(() => {
  let isMounted = true;
  const controller = new AbortController();

  const uploadImageSafe = async (file: File) => {
    try {
      setIsUploading(true);
      const result = await uploadImage(file, { signal: controller.signal });
      if (isMounted) {
        setUploadedImage(result);
        setIsUploading(false);
      }
    } catch (error) {
      if (isMounted) {
        setIsUploading(false);
        if (error instanceof DOMException && error.name === 'AbortError') {
          return; // 정상적인 취소
        }
        showErrorToast('이미지 업로드에 실패했습니다.');
      }
    }
  };

  if (pendingFile) {
    uploadImageSafe(pendingFile);
  }

  return () => {
    isMounted = false;
    controller.abort();
  };
}, [pendingFile]);
```

---

## 3. 테스트 체크리스트

- [ ] **iOS Safari**: 카메라 촬영 후 이미지 첨부 (HEIC 포맷)
- [ ] **iOS Safari**: 갤러리에서 이미지 선택 첨부
- [ ] **Android Chrome**: 카메라 촬영 후 이미지 첨부
- [ ] **Android Chrome**: 갤러리에서 이미지 선택 첨부
- [ ] **대용량 이미지**: 10MB 이상 이미지 첨부 시 정상 압축 확인
- [ ] **파일 선택 취소**: 파일 다이얼로그에서 취소 버튼 클릭 시 크래시 없음
- [ ] **지원하지 않는 형식**: PDF, BMP 등 비지원 형식 선택 시 에러 메시지 표시
- [ ] **네트워크 끊김 상태**: 업로드 중 네트워크 끊김 시 적절한 에러 처리
- [ ] **연속 첨부**: 빠르게 여러 이미지 연속 첨부 시 정상 동작
- [ ] **컴포넌트 이탈**: 업로드 진행 중 페이지 이동 시 크래시 없음
- [ ] **메모리 사용량**: Chrome DevTools / Xcode Instruments로 메모리 누수 확인

---

## 4. 영향 범위

| 영역 | 영향도 | 설명 |
|------|--------|------|
| 이미지 첨부 기능 | 🔴 높음 | 직접 수정 대상 |
| 파일 업로드 서비스 | 🟡 중간 | 압축된 이미지 형식 변경에 따른 서버 사이드 확인 필요 |
| UI/UX | 🟢 낮음 | 에러 메시지 추가로 인한 사용자 경험 개선 |

---

## 5. 비고

- 실제 대상 소스 파일 경로를 확인할 수 없어 추정 기반으로 분석했습니다.
- 담당 개발자는 위 수정 방안을 참고하여 실제 코드에 적용해 주세요.
- P0/Critical 이슈이므로 핫픽스 배포를 권장합니다.
