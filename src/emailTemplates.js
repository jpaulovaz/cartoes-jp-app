const { resolveMessage } = require('./messageResolver');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildRoleLabel(role) {
  return String(role || '').trim().toLowerCase() === 'admin'
    ? 'Administrador(a)'
    : 'Usuário do app';
}

function buildEmailHtml({ eyebrow, heading, bodyText, ctaHref = '', ctaLabel = '' } = {}) {
  const safeBodyHtml = escapeHtml(String(bodyText || '').trim()).replace(/\n/g, '<br>');
  const safeCtaHref = String(ctaHref || '').trim();
  const safeCtaLabel = String(ctaLabel || '').trim();

  return `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:24px;background:#f1f5f9;font-family:Inter,Segoe UI,Roboto,Arial,sans-serif;color:#0f172a;">
    <div style="max-width:620px;margin:0 auto;background:#ffffff;border-radius:28px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 20px 45px rgba(15,23,42,.08);">
      <div style="padding:28px 28px 20px;background:linear-gradient(135deg,#0f172a,#2563eb);color:#ffffff;">
        <div style="font-size:12px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;opacity:.8;">${escapeHtml(eyebrow || 'Mensagem do app')}</div>
        <h1 style="margin:14px 0 0;font-size:28px;line-height:1.15;">${escapeHtml(heading || 'Oi!')}</h1>
      </div>
      <div style="padding:28px;">
        <div style="font-size:15px;line-height:1.8;color:#334155;">${safeBodyHtml || '&nbsp;'}</div>
        ${safeCtaHref && safeCtaLabel ? `<a href="${escapeHtml(safeCtaHref)}" style="display:inline-block;margin-top:22px;padding:14px 22px;border-radius:16px;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:800;font-size:15px;">${escapeHtml(safeCtaLabel)}</a>` : ''}
        ${safeCtaHref ? `<div style="margin-top:24px;padding-top:18px;border-top:1px solid #e2e8f0;color:#64748b;font-size:13px;line-height:1.7;"><div>Se precisar copiar o link na mão, segue ele aqui:</div><div style="margin-top:8px;word-break:break-all;color:#0f172a;">${escapeHtml(safeCtaHref)}</div></div>` : ''}
      </div>
    </div>
  </body>
</html>`;
}

function buildWelcomeEmailTemplate({
  appName = 'AcerttaPay',
  recipientName = '',
  adminName = '',
  loginUrl = '',
  role = 'user',
  customMessage = '',
  subject = ''
} = {}) {
  const safeAppName = String(appName || 'AcerttaPay').trim() || 'AcerttaPay';
  const safeRecipientName = String(recipientName || '').trim();
  const safeAdminName = String(adminName || '').trim();
  const safeLoginUrl = String(loginUrl || '').trim();
  const safeCustomMessage = String(customMessage || '').trim();
  const safeSubject = String(subject || '').trim();
  const roleLabel = buildRoleLabel(role);
  const fallbackSubject = safeSubject || `Seu acesso ao ${safeAppName} já está liberado 🎉`;
  const fallbackBody = [
    safeRecipientName ? `Oi, ${safeRecipientName}!` : 'Oi!',
    '',
    safeAdminName
      ? `${safeAdminName} liberou seu acesso ao ${safeAppName}.`
      : `Seu acesso ao ${safeAppName} já está liberado.`,
    `Seu perfil entrou como ${roleLabel}.`,
    'Para entrar, use a mesma conta Google deste e-mail.',
    safeLoginUrl ? `Link de entrada: ${safeLoginUrl}` : '',
    safeCustomMessage ? '' : '',
    safeCustomMessage ? `Recado de quem te chamou: ${safeCustomMessage}` : ''
  ].filter(Boolean).join('\n');

  const resolved = resolveMessage('email.admin_access.welcome', {
    app: safeAppName,
    nome: safeRecipientName,
    admin_ou_sistema: safeAdminName || 'O admin do app',
    perfil: roleLabel,
    link_login: safeLoginUrl || '(link não informado)',
    recado_admin: safeCustomMessage
  }, {
    fallbackTitle: fallbackSubject,
    fallbackBody
  });

  const bodyText = resolved.body || fallbackBody;
  const subjectLine = resolved.title || fallbackSubject;
  const html = buildEmailHtml({
    eyebrow: 'Acesso liberado',
    heading: safeRecipientName ? `Oi, ${safeRecipientName}!` : 'Oi!',
    bodyText,
    ctaHref: safeLoginUrl,
    ctaLabel: safeLoginUrl ? `Entrar no ${safeAppName}` : ''
  });

  return {
    subject: subjectLine,
    html,
    text: bodyText,
    preview: bodyText.split('\n').find((line) => String(line || '').trim()) || bodyText
  };
}

function buildTestEmailTemplate({
  appName = 'AcerttaPay',
  recipientName = '',
  adminName = '',
  loginUrl = ''
} = {}) {
  const safeAppName = String(appName || 'AcerttaPay').trim() || 'AcerttaPay';
  const safeRecipientName = String(recipientName || '').trim();
  const safeAdminName = String(adminName || '').trim();
  const safeLoginUrl = String(loginUrl || '').trim();
  const fallbackSubject = `Teste de e-mail do ${safeAppName} ✉️`;
  const fallbackBody = [
    safeRecipientName ? `Oi, ${safeRecipientName}!` : 'Oi!',
    '',
    safeAdminName
      ? `${safeAdminName} acabou de testar a trilha de e-mail do ${safeAppName}.`
      : `Alguém do time acabou de testar a trilha de e-mail do ${safeAppName}.`,
    'Se esta mensagem chegou, o SMTP já está respirando bem e pronto para mandar os boas-vindas do Admin.',
    safeLoginUrl ? `Link atual de entrada: ${safeLoginUrl}` : ''
  ].filter(Boolean).join('\n');

  const resolved = resolveMessage('email.admin_access.test', {
    app: safeAppName,
    nome: safeRecipientName,
    admin_ou_time: safeAdminName || 'Alguém do time',
    link_login: safeLoginUrl || '(link não informado)'
  }, {
    fallbackTitle: fallbackSubject,
    fallbackBody
  });

  const bodyText = resolved.body || fallbackBody;
  const subjectLine = resolved.title || fallbackSubject;
  const html = buildEmailHtml({
    eyebrow: 'Teste de conexão',
    heading: safeRecipientName ? `Oi, ${safeRecipientName}!` : 'Oi!',
    bodyText,
    ctaHref: safeLoginUrl,
    ctaLabel: safeLoginUrl ? `Abrir ${safeAppName}` : ''
  });

  return {
    subject: subjectLine,
    html,
    text: bodyText,
    preview: bodyText.split('\n').find((line) => String(line || '').trim()) || bodyText
  };
}

module.exports = {
  buildRoleLabel,
  buildWelcomeEmailTemplate,
  buildTestEmailTemplate
};
