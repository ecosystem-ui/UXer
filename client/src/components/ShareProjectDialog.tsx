import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemText,
  TextField,
  Typography,
} from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { api } from '../api/client';
import type { ProjectMember } from '../api/types';

function copyWithHiddenTextarea(text: string) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(textarea);
  if (!ok) throw new Error('copy failed');
}

interface ShareProjectDialogProps {
  open: boolean;
  projectId: string;
  onClose: () => void;
}

export default function ShareProjectDialog({ open, projectId, onClose }: ShareProjectDialogProps) {
  const { t } = useTranslation();
  const [members, setMembers] = useState<ProjectMember[] | null>(null);
  const [email, setEmail] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');

  const loadMembers = useCallback(() => {
    api
      .listMembers(projectId)
      .then(setMembers)
      .catch(() => setMembers([]));
  }, [projectId]);

  useEffect(() => {
    if (!open || !projectId) return;
    setMembers(null);
    setEmail('');
    setError('');
    setLink(window.location.href);
    setCopied(false);
    setCopyError('');
    loadMembers();
  }, [open, projectId, loadMembers]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copyLink = async () => {
    const url = link || window.location.href;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        copyWithHiddenTextarea(url);
      }
      setCopyError('');
      setCopied(true);
    } catch {
      try {
        copyWithHiddenTextarea(url);
        setCopyError('');
        setCopied(true);
      } catch {
        setCopyError(t('share.copyFailed'));
      }
    }
  };

  const addMember = async () => {
    const address = email.trim();
    if (!address) return;
    setAdding(true);
    setError('');
    try {
      await api.addMember(projectId, address);
      setEmail('');
      loadMembers();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('share.addFailed'));
    } finally {
      setAdding(false);
    }
  };

  const removeMember = async (memberEmail: string) => {
    await api.removeMember(projectId, memberEmail);
    loadMembers();
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('share.title')}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('share.subtitle')}
        </Typography>
        <Box sx={{ mb: 2.5 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            {t('share.shareLink')}
          </Typography>
          <Box display="flex" gap={1} alignItems="flex-start">
            <TextField
              fullWidth
              size="small"
              value={link}
              onFocus={(e) => e.target.select()}
              slotProps={{ input: { readOnly: true, sx: { fontSize: 13 } } }}
            />
            <IconButton
              onClick={copyLink}
              aria-label={copied ? t('share.linkCopied') : t('share.copyLink')}
              title={copied ? t('share.copied') : t('share.copyLink')}
              sx={{ alignSelf: 'flex-start', width: 40, height: 40 }}
            >
              {copied ? (
                <CheckIcon fontSize="small" color="success" />
              ) : (
                <ContentCopyIcon fontSize="small" />
              )}
            </IconButton>
          </Box>
          {copyError && (
            <Typography variant="caption" color="error">
              {copyError}
            </Typography>
          )}
        </Box>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          {t('share.addPermission')}
        </Typography>
        <Box display="flex" gap={1}>
          <TextField
            fullWidth
            label={t('share.emailAddress')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addMember();
            }}
            error={Boolean(error)}
            helperText={error}
            placeholder={t('share.emailPlaceholder')}
          />
          <Button
            variant="contained"
            onClick={addMember}
            disabled={adding || !email.trim()}
            sx={{ alignSelf: 'flex-start', mt: 0.5 }}
          >
            {t('common.add')}
          </Button>
        </Box>
        {members === null ? (
          <Box display="flex" justifyContent="center" py={2}>
            <CircularProgress size={24} />
          </Box>
        ) : members.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            {t('share.noAccessYet')}
          </Typography>
        ) : (
          <List
            sx={{
              mt: 1,
              ...(members.length > 3 ? { maxHeight: 140, overflowY: 'auto', pr: 1 } : {}),
            }}
          >
            {members.map((m) => (
              <ListItem
                key={m.email}
                disablePadding
                secondaryAction={
                  <IconButton
                    edge="end"
                    aria-label={t('share.removeMember', { email: m.email })}
                    onClick={() => removeMember(m.email)}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                }
              >
                <ListItemText
                  primary={m.name || m.email}
                  secondary={`${m.email} · ${m.pending ? t('share.roleInvited') : t('share.roleViewer')}`}
                />
              </ListItem>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.done')}</Button>
      </DialogActions>
    </Dialog>
  );
}
