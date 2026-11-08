import { IconButton, Tooltip } from '@mui/material';
import TranslateIcon from '@mui/icons-material/Translate';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES, setLanguage, type SupportedLanguage } from '../i18n';

export default function LanguageToggle() {
  const { t, i18n } = useTranslation();
  const current = i18n.language as SupportedLanguage;
  const next: SupportedLanguage =
    current === SUPPORTED_LANGUAGES[0] ? SUPPORTED_LANGUAGES[1] : SUPPORTED_LANGUAGES[0];

  return (
    <Tooltip title={t('language.label')}>
      <IconButton onClick={() => setLanguage(next)} aria-label={t('language.label')}>
        <TranslateIcon />
      </IconButton>
    </Tooltip>
  );
}
