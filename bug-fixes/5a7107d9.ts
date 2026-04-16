// NotificationSettings.ts
import { useEffect, useState } from 'react';

const NotificationSettings = () => {
  const [settings, setSettings] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  // 초기 설정 로드
  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const response = await fetch('/api/notifications/settings');
      const data = await response.json();
      setSettings(data);
    } catch (error) {
      console.error('설정 로드 실패:', error);
    }
  };

  const handleToggleChange = async (key: string, value: boolean) => {
    // 즉시 UI 업데이트 (낙관적 업데이트)
    const updatedSettings = { ...settings, [key]: value };
    setSettings(updatedSettings);

    // 서버에 저장 (race condition 방지)
    setIsSaving(true);
    try {
      const response = await fetch('/api/notifications/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updatedSettings),
      });

      if (!response.ok) {
        throw new Error('저장 실패');
      }

      // 서버에서 반환한 데이터로 상태 확정
      const savedData = await response.json();
      setSettings(savedData);
    } catch (error) {
      console.error('설정 저장 실패:', error);
      // 실패 시 이전 상태로 복원
      await loadSettings();
    } finally {
      setIsSaving(false);
    }
  };

  if (settings === null) return <div>로딩 중...</div>;

  return (
    <div className="notification-settings">
      <label>
        <input
          type="checkbox"
          checked={settings.emailNotifications}
          onChange={(e) => handleToggleChange('emailNotifications', e.target.checked)}
          disabled={isSaving}
        />
        이메일 알림
      </label>
      <label>
        <input
          type="checkbox"
          checked={settings.pushNotifications}
          onChange={(e) => handleToggleChange('pushNotifications', e.target.checked)}
          disabled={isSaving}
        />
        푸시 알림
      </label>
      {isSaving && <span className="saving-indicator">저장 중...</span>}
    </div>
  );
};

export default NotificationSettings;