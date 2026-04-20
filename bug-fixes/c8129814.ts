// 로그인 페이지 비밀번호 입력 필드 컴포넌트

export class LoginPasswordInput {
  // 기존 코드 (버그)
  // <input type="password" onInput="validatePassword(event)" />
  
  // 수정된 코드
  private passwordInput: HTMLInputElement;

  constructor() {
    this.passwordInput = document.querySelector('input[type="password"]');
    this.setupPasswordInput();
  }

  private setupPasswordInput(): void {
    // HTML5 input의 기본 제한 제거
    this.passwordInput.removeAttribute('pattern');
    
    // 한글 입력을 포함한 모든 문자 허용
    this.passwordInput.addEventListener('input', (event) => {
      const target = event.target as HTMLInputElement;
      // 입력 값을 그대로 유지 (필터링 제거)
      target.value = target.value;
    });

    // 붙여넣기(paste) 이벤트도 한글 허용
    this.passwordInput.addEventListener('paste', (event) => {
      event.preventDefault();
      const pastedText = (event.clipboardData || (window as any).clipboardData).getData('text');
      this.passwordInput.value += pastedText;
    });
  }

  // 비밀번호 유효성 검사 (한글 포함 가능)
  validatePassword(password: string): boolean {
    // 빈 값 체크만 수행
    return password.length > 0 && password.length <= 128;
  }

  // 비밀번호 제출 (한글 인코딩)
  submitPassword(): string {
    const rawPassword = this.passwordInput.value;
    // UTF-8로 인코딩하여 전송
    return encodeURIComponent(rawPassword);
  }
}