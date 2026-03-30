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
  const safeSubject = String(subject || '').trim() || `Seu acesso ao ${safeAppName} foi liberado`;
  const roleLabel = buildRoleLabel(role);
  const greeting = safeRecipientName ? `Oi, ${safeRecipientName}!` : 'Oi!';
  const inviterLine = safeAdminName
    ? `${safeAdminName} liberou o seu acesso ao ${safeAppName}.`
    : `Seu acesso ao ${safeAppName} foi liberado.`;
  const actionLine = 'Para entrar, use a mesma conta Google deste e-mail.';
  const customBlockHtml = safeCustomMessage
    ? `<div style="margin-top:16px;padding:14px 16px;border-radius:16px;background:#f8fafc;border:1px solid #e2e8f0;color:#334155;font-size:14px;line-height:1.6;"><strong style="display:block;margin-bottom:6px;color:#0f172a;">Recado do admin</strong>${escapeHtml(safeCustomMessage).replace(/\n/g, '<br>')}</div>`
    : '';
  const customBlockText = safeCustomMessage
    ? `\n\nRecado do admin:\n${safeCustomMessage}`
    : '';

  const html = `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:24px;background:#f1f5f9;font-family:Inter,Segoe UI,Roboto,Arial,sans-serif;color:#0f172a;">
    <div style="max-width:620px;margin:0 auto;background:#ffffff;border-radius:28px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 20px 45px rgba(15,23,42,.08);">
      <div style="padding:28px 28px 20px;background:linear-gradient(135deg,#0f172a,#2563eb);color:#ffffff;">
        <div style="font-size:12px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;opacity:.8;">Acesso liberado</div>
        <h1 style="margin:14px 0 8px;font-size:28px;line-height:1.15;">${escapeHtml(greeting)}</h1>
        <p style="margin:0;font-size:15px;line-height:1.7;opacity:.92;">${escapeHtml(inviterLine)} Seu perfil entrou como <strong>${escapeHtml(roleLabel)}</strong>.</p>
      </div>
      <div style="padding:28px;">
        <p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#334155;">${escapeHtml(actionLine)}</p>
        <p style="margin:0 0 22px;font-size:15px;line-height:1.7;color:#334155;">Nada de senha por e-mail nem código temporário: é só entrar com a conta Google certa e deixar o resto com a casa.</p>
        ${safeLoginUrl ? `<a href="${escapeHtml(safeLoginUrl)}" style="display:inline-block;padding:14px 22px;border-radius:16px;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:800;font-size:15px;">Entrar no ${escapeHtml(safeAppName)}</a>` : ''}
        ${customBlockHtml}
        <div style="margin-top:24px;padding-top:18px;border-top:1px solid #e2e8f0;color:#64748b;font-size:13px;line-height:1.7;">
          <div>Se o botão não abrir de primeira, copie e cole este link no navegador:</div>
          <div style="margin-top:8px;word-break:break-all;color:#0f172a;">${escapeHtml(safeLoginUrl || 'Link não informado')}</div>
        </div>
      </div>
    </div>
  </body>
</html>`;

  const text = `${greeting}

${inviterLine}
Seu perfil entrou como ${roleLabel}.

${actionLine}
Nada de senha por e-mail nem código temporário: é só entrar com a conta Google certa.

Entrar no ${safeAppName}: ${safeLoginUrl || '(link não informado)'}${customBlockText}`;

  return {
    subject: safeSubject,
    html,
    text,
    preview: inviterLine
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
  const greeting = safeRecipientName ? `Oi, ${safeRecipientName}!` : 'Oi!';
  const adminLine = safeAdminName
    ? `${safeAdminName} acabou de testar a trilha de e-mail do ${safeAppName}.`
    : `Alguém do time acabou de testar a trilha de e-mail do ${safeAppName}.`;
  const subject = `Teste de e-mail do ${safeAppName}`;

  const html = `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:24px;background:#f8fafc;font-family:Inter,Segoe UI,Roboto,Arial,sans-serif;color:#0f172a;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:24px;border:1px solid #e2e8f0;padding:28px;box-shadow:0 18px 40px rgba(15,23,42,.07);">
      <div style="font-size:12px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#2563eb;">Teste de conexão</div>
      <h1 style="margin:12px 0 10px;font-size:26px;line-height:1.15;">${escapeHtml(greeting)}</h1>
      <p style="margin:0;font-size:15px;line-height:1.7;color:#334155;">${escapeHtml(adminLine)}</p>
      <p style="margin:16px 0 0;font-size:15px;line-height:1.7;color:#334155;">Se esta mensagem chegou, o SMTP já está respirando bem e pronto para mandar os boas-vindas do Admin.</p>
      ${safeLoginUrl ? `<p style="margin:18px 0 0;font-size:14px;color:#64748b;">Link atual de entrada: <a href="${escapeHtml(safeLoginUrl)}" style="color:#2563eb;">${escapeHtml(safeLoginUrl)}</a></p>` : ''}
    </div>
  </body>
</html>`;

  const text = `${greeting}\n\n${adminLine}\n\nSe esta mensagem chegou, o SMTP já está pronto para mandar os boas-vindas do Admin.\n${safeLoginUrl ? `\nLink atual de entrada: ${safeLoginUrl}` : ''}`;

  return { subject, html, text, preview: adminLine };
}

module.exports = {
  buildRoleLabel,
  buildWelcomeEmailTemplate,
  buildTestEmailTemplate
};
