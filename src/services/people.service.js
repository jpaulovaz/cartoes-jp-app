const { createPeopleRepository } = require('../repositories/people.repository');
const { createAutomationApiService } = require('./automationApi.service');

function createPeopleService(deps = {}) {
  const repository = deps.repository || createPeopleRepository(deps);
  const automationService = deps.automationService || createAutomationApiService(deps);

  function getPeoplePageViewModel(req) {
    return deps.buildPeoplePageViewModel(req);
  }

  async function uploadProfilePhoto({ userId, req, file, error, currentUser }) {
    const uploadedPath = file ? `/uploads/profile-photos/${file.filename}` : '';
    const redirectTo = deps.resolvePeopleSettingsRedirectTarget(req, '/settings#profile-photo');
    if (error) {
      if (uploadedPath) await deps.removeManagedProfilePhoto(uploadedPath);
      return { redirectTo, flash: { type: 'error', message: error.message || 'Não consegui salvar sua foto agora.' } };
    }

    if (!uploadedPath) {
      return { redirectTo, flash: { type: 'error', message: 'Escolha uma imagem antes de salvar a foto do perfil.' } };
    }

    try {
      const previousUser = deps.getUserRecord(userId, { includeDeleted: false });
      repository.updateUserProfilePhoto(userId, uploadedPath, 'manual');
      if (currentUser) {
        currentUser.profile_photo_url = uploadedPath;
        currentUser.profile_photo_mode = 'manual';
      }
      if (previousUser?.profile_photo_url) await deps.removeManagedProfilePhoto(previousUser.profile_photo_url);
      return { redirectTo, flash: { type: 'success', message: 'Foto nova no crachá! Já deixei seu perfil mais reconhecível por aqui.' } };
    } catch (err) {
      await deps.removeManagedProfilePhoto(uploadedPath);
      return { redirectTo, flash: { type: 'error', message: 'A foto tropeçou no caminho. Tenta de novo daqui a pouquinho.' } };
    }
  }

  async function useDefaultProfilePhoto({ userId, req, currentUser }) {
    const redirectTo = deps.resolvePeopleSettingsRedirectTarget(req, '/settings#profile-photo');
    try {
      const previousUser = deps.getUserRecord(userId, { includeDeleted: false });
      repository.updateUserProfilePhoto(userId, null, 'default');
      if (currentUser) {
        currentUser.profile_photo_url = '';
        currentUser.profile_photo_mode = 'default';
      }
      if (previousUser?.profile_photo_url) await deps.removeManagedProfilePhoto(previousUser.profile_photo_url);
      return {
        redirectTo,
        flash: {
          type: 'success',
          message: previousUser?.google_photo_url && !deps.looksLikeGoogleDefaultAvatar(previousUser.google_photo_url)
            ? 'Voltei para sua foto do Google aqui no app.'
            : 'Voltei para o visual padrão com o ícone do app no cabeçalho.'
        }
      };
    } catch (error) {
      return { redirectTo, flash: { type: 'error', message: 'Não consegui voltar para o padrão agora.' } };
    }
  }

  async function removeProfilePhoto({ userId, req, currentUser }) {
    const redirectTo = deps.resolvePeopleSettingsRedirectTarget(req, '/settings#profile-photo');
    try {
      const previousUser = deps.getUserRecord(userId, { includeDeleted: false });
      repository.updateUserProfilePhoto(userId, null, 'none');
      if (currentUser) {
        currentUser.profile_photo_url = '';
        currentUser.profile_photo_mode = 'none';
      }
      if (previousUser?.profile_photo_url) await deps.removeManagedProfilePhoto(previousUser.profile_photo_url);
      return {
        redirectTo,
        flash: { type: 'success', message: 'Pronto, escondi sua foto por aqui e deixei o app no modo sem avatar.' }
      };
    } catch (error) {
      return { redirectTo, flash: { type: 'error', message: 'Não consegui remover a foto agora.' } };
    }
  }

  function redirectComprasComigo({ userId, personId }) {
    if (!personId) {
      return { redirectTo: '/people', flash: { type: 'error', message: 'Esse atalho de amizade chegou sem endereço.' } };
    }

    try {
      const preferred = deps.getPreferredPeopleComprasComigoMonth(userId, personId);
      if (!preferred) {
        return { redirectTo: '/people', flash: { type: 'error', message: 'Essa amizade ainda não está pronta para abrir as compras por aqui.' } };
      }

      return { redirectTo: `/people/${personId}/compras-comigo/${preferred.year}/${preferred.month}` };
    } catch (error) {
      return { redirectTo: '/people', flash: { type: 'error', message: error?.message || 'Não consegui abrir esse resumo agora.' } };
    }
  }

  function getComprasComigoPage({ userId, personId, params, query }) {
    const parsed = deps.parseMonthYear(params.month, params.year);
    if (!parsed) return { badRequest: 'Esse mês/ano veio estranho por aqui.' };

    const comprasFilters = {
      q: String(query.q || '').trim().slice(0, 120),
      status: String(query.status || 'all').trim().toLowerCase()
    };

    try {
      const ledger = deps.buildPeopleComprasComigoLedger(userId, personId, parsed.month, parsed.year, { filters: comprasFilters });
      const contact = ledger.contact;
      const prevMonth = deps.shiftMonth(parsed.year, parsed.month, -1);
      const nextMonth = deps.shiftMonth(parsed.year, parsed.month, 1);
      const now = deps.dayjs();
      const currentMonth = { year: now.year(), month: now.month() + 1 };
      const isCurrentMonth = currentMonth.year === parsed.year && currentMonth.month === parsed.month;
      const basePath = `/people/${personId}/compras-comigo/${parsed.year}/${parsed.month}`;
      const currentMonthPath = `/people/${personId}/compras-comigo/${currentMonth.year}/${currentMonth.month}`;
      const queryEntries = Object.entries(comprasFilters)
        .filter(([, value]) => value && String(value).trim() && String(value).trim() !== 'all');
      const querySuffix = queryEntries.length ? `?${new URLSearchParams(queryEntries).toString()}` : '';

      return {
        viewModel: {
          title: `AcerttaPay | Compras com ${contact.name || 'Amizade'}`,
          person: contact,
          contact,
          month: parsed.month,
          year: parsed.year,
          monthLabel: deps.monthLabel,
          formatBRLFromCents: deps.formatBRLFromCents,
          formatDateBR: deps.formatDateBR,
          outgoingRows: ledger.outgoingRows || [],
          incomingOpenItems: ledger.incomingOpenItems || ledger.openItems || [],
          incomingHistoryItems: ledger.incomingHistoryItems || ledger.historyItems || [],
          openItems: ledger.openItems,
          historyItems: ledger.historyItems,
          summary: ledger.summary,
          comprasFilters,
          availableRanks: ledger.availableRanks,
          previousMonthHref: `/people/${personId}/compras-comigo/${prevMonth.year}/${prevMonth.month}${querySuffix}`,
          nextMonthHref: `/people/${personId}/compras-comigo/${nextMonth.year}/${nextMonth.month}${querySuffix}`,
          currentMonthHref: `${currentMonthPath}${querySuffix}`,
          clearFiltersHref: basePath,
          backHref: '/people#network-lounge',
          sharedDebtsHref: '/shared-debts',
          draftQueuesHref: '/shared-debts#draft-queues',
          isCurrentMonth
        }
      };
    } catch (error) {
      return { redirectTo: '/people', flash: { type: 'error', message: error?.message || 'Não consegui abrir as compras dessa amizade agora.' } };
    }
  }

  function createComprasComigoChargeDraft({ userId, personId, params, body }) {
    const parsed = deps.parseMonthYear(params.month, params.year);
    const fallback = parsed
      ? `/people/${personId}/compras-comigo/${parsed.year}/${parsed.month}`
      : `/people/${personId}/compras-comigo`;
    if (!parsed) {
      return { redirectTo: '/people', flash: { type: 'error', message: 'Esse mês/ano veio estranho por aqui.' } };
    }

    const transactionId = Number(body.transaction_id || body.transactionId || 0);
    const scope = String(body.scope || 'single').trim().toLowerCase() === 'future' ? 'future' : 'single';
    if (!transactionId) {
      return { redirectTo: fallback, flash: { type: 'error', message: 'Escolha uma compra válida para criar a cobrança.' } };
    }

    try {
      const result = deps.createPeopleComprasComigoChargeDraft(userId, personId, transactionId, { scope, month: parsed.month, year: parsed.year });
      const itemCount = Number(result.itemCount || 0);
      const skippedCount = Number(result.skippedCount || 0);
      if (!itemCount) {
        return {
          redirectTo: fallback,
          flash: { type: 'info', message: 'Não criei cobrança nova porque essa divisão já está na caixa de saída ou já possui cobrança ativa.' }
        };
      }

      const periodPart = scope === 'future' && itemCount > 1
        ? `${itemCount} parcelas entraram`
        : 'A cobrança entrou';
      const skippedPart = skippedCount > 0
        ? ` ${skippedCount} item(ns) já tinham cobrança ou não estavam elegíveis e ficaram de fora.`
        : '';

      return {
        redirectTo: `${fallback}?status=all#eu-marquei`,
        flash: {
          type: 'success',
          message: `${periodPart} na caixa de saída. Revise e envie quando quiser.${skippedPart}`
        }
      };
    } catch (error) {
      return {
        redirectTo: fallback,
        flash: { type: 'error', message: error?.message || 'Não consegui criar essa cobrança agora.' }
      };
    }
  }

  function saveNotificationPreferences({ userId, body, req }) {
    try {
      const nextValues = deps.USER_NOTIFICATION_PREFERENCE_KEYS.reduce((acc, key) => {
        acc[key] = deps.normalizeNotificationPreferenceToggle(body[`pref_${key}`]);
        return acc;
      }, {});

      deps.upsertUserNotificationPreferences(userId, nextValues);
      return {
        redirectTo: deps.resolvePeopleSettingsRedirectTarget(req, '/settings#alerts'),
        flash: { type: 'success', message: 'Pronto! Seus alertas por assunto ficaram salvos do seu jeitinho.' }
      };
    } catch (error) {
      return {
        redirectTo: deps.resolvePeopleSettingsRedirectTarget(req, '/settings#alerts'),
        flash: { type: 'error', message: error?.message || 'Não consegui salvar suas preferências de alerta agora.' }
      };
    }
  }

  function enableWhatsappAutomation({ userId, req }) {
    const redirectTo = deps.resolvePeopleSettingsRedirectTarget(req, '/settings#whatsapp-automation');
    try {
      const result = automationService.enableWhatsappForUser(userId);
      return {
        redirectTo,
        flash: {
          type: 'success',
          message: `WhatsApp do AcerttaPay ligado para ${result.display_phone || result.phone_e164}. Pode mandar compra que a gente tenta acertar a fatura sem drama.`
        }
      };
    } catch (error) {
      return {
        redirectTo,
        flash: {
          type: 'error',
          message: error?.message || 'Não consegui ativar o WhatsApp automático agora.'
        }
      };
    }
  }

  function disableWhatsappAutomation({ userId, req }) {
    const redirectTo = deps.resolvePeopleSettingsRedirectTarget(req, '/settings#whatsapp-automation');
    try {
      automationService.disableWhatsappForUser(userId);
      return {
        redirectTo,
        flash: {
          type: 'success',
          message: 'WhatsApp automático desligado. O app segue na paz, só sem lançar compras por mensagem.'
        }
      };
    } catch (error) {
      return {
        redirectTo,
        flash: {
          type: 'error',
          message: error?.message || 'Não consegui desligar o WhatsApp automático agora.'
        }
      };
    }
  }

  function savePerson({ userId, body, req, currentUser }) {
    const id = Number(body.id) || null;
    const targetPerson = id ? repository.getEditablePerson(userId, id) : null;
    const isSelfTarget = deps.isSelfPersonRow(targetPerson);
    const requestedSection = isSelfTarget ? String(body.profile_section || '').trim().toLowerCase() : '';
    const defaultRedirectTarget = isSelfTarget
      ? (requestedSection === 'pix' ? '/settings#pix' : requestedSection === 'signature' ? '/people#profile-signature' : '/settings#profile')
      : '/people#network-lounge';
    const redirectTo = deps.resolvePeopleSettingsRedirectTarget(req, defaultRedirectTarget);

    const currentName = targetPerson ? String(targetPerson.name || '').trim() : '';
    const currentPhone = targetPerson ? String(targetPerson.phone || '').trim() : '';
    const currentEmail = targetPerson ? deps.normalizeEmail(targetPerson.email) : null;
    const requestedPhoneCountry = String(body.phone_country || deps.DEFAULT_PHONE_COUNTRY).trim().toUpperCase() || deps.DEFAULT_PHONE_COUNTRY;

    const name = isSelfTarget && requestedSection === 'pix' ? currentName : String(body.name || '').trim();
    const rawPhoneInput = isSelfTarget && requestedSection === 'pix' ? currentPhone : String(body.phone || '').trim();
    const normalizedPhone = isSelfTarget && requestedSection === 'pix'
      ? { ok: true, value: currentPhone, countryCode: requestedPhoneCountry }
      : deps.normalizePhoneForStorage(rawPhoneInput, requestedPhoneCountry, { allowEmpty: true });
    const phone = normalizedPhone.ok ? normalizedPhone.value : rawPhoneInput;
    const email = isSelfTarget && requestedSection === 'pix' ? currentEmail : deps.normalizeEmail(body.email);

    const currentPixEnabled = isSelfTarget ? deps.normalizePixToggle(targetPerson?.pix_enabled) : false;
    const currentPixKeyType = isSelfTarget ? deps.normalizePixKeyType(targetPerson?.pix_key_type) : null;
    const currentPixKeyValue = isSelfTarget ? deps.normalizePixKeyValue(targetPerson?.pix_key_type, targetPerson?.pix_key_value) : null;
    const currentPixStateRaw = isSelfTarget
      ? (deps.normalizePixState(targetPerson?.pix_state) || deps.guessPixStateByCity(targetPerson?.pix_city) || null)
      : null;
    const currentPixCityRaw = isSelfTarget ? String(targetPerson?.pix_city || '').trim() : '';
    const currentPixLabelRaw = isSelfTarget ? String(targetPerson?.pix_label || '').trim() : '';

    const pixEnabled = isSelfTarget
      ? deps.normalizePixToggle(requestedSection === 'identity' ? currentPixEnabled : body.pix_enabled)
      : false;
    const pixKeyType = isSelfTarget
      ? deps.normalizePixKeyType(requestedSection === 'identity' ? currentPixKeyType : body.pix_key_type)
      : null;
    const pixKeyValue = isSelfTarget
      ? deps.normalizePixKeyValue(pixKeyType, requestedSection === 'identity' ? currentPixKeyValue : body.pix_key_value)
      : null;
    const pixStateRaw = isSelfTarget
      ? (requestedSection === 'identity'
        ? currentPixStateRaw
        : (deps.normalizePixState(body.pix_state) || deps.guessPixStateByCity(body.pix_city) || null))
      : null;
    const pixCityRaw = isSelfTarget ? (requestedSection === 'identity' ? currentPixCityRaw : String(body.pix_city || '').trim()) : '';
    const pixLabelRaw = isSelfTarget ? (requestedSection === 'identity' ? currentPixLabelRaw : String(body.pix_label || '').trim()) : '';
    const duplicatedPerson = deps.findPersonByNameForUser(userId, name, id);
    const pixProfile = isSelfTarget
      ? deps.validatePixProfile({
          enabled: pixEnabled,
          keyType: pixKeyType,
          keyValue: pixKeyValue,
          city: pixCityRaw,
          state: pixStateRaw,
          label: pixLabelRaw,
          name: name || email || 'ACERTTAPAY'
        })
      : { valid: true, enabled: false, keyType: null, keyValue: null, city: null, state: null, label: null };
    const storedPixProfile = pixEnabled ? pixProfile : { keyType: null, keyValue: null, city: null, state: null, label: null };

    if (id && !targetPerson) {
      return { redirectTo: deps.resolvePeopleSettingsRedirectTarget(req, '/people'), flash: { type: 'error', message: 'Não encontrei essa pessoa por aqui para atualizar.' } };
    }

    if (isSelfTarget && requestedSection === 'signature') {
      const signatureText = deps.normalizeProfileSignatureText(body.profile_signature_text);
      const signatureVibe = deps.normalizeProfileSignatureVibe(body.profile_signature_vibe);
      repository.updateUserProfileSignature(userId, signatureText, signatureVibe, (signatureText || signatureVibe) ? deps.nowIso() : null);
      if (currentUser) {
        currentUser.profile_signature_text = signatureText;
        currentUser.profile_signature_vibe = signatureVibe;
      }
      return {
        redirectTo,
        flash: {
          type: 'success',
          message: signatureText || signatureVibe
            ? 'Sua assinatura no app ficou salva do seu jeitinho.'
            : 'Sua assinatura voltou para o modo discreto por aqui.'
        }
      };
    }

    if (!name) {
      return {
        redirectTo,
        flash: {
          type: 'error',
          message: id && deps.isSelfPersonRow(targetPerson)
            ? 'Me passa pelo menos como você quer aparecer no app para eu salvar seu perfil direitinho.'
            : 'Me dá pelo menos o nome dessa pessoa para eu conseguir salvar direitinho.'
        }
      };
    }

    if (duplicatedPerson) {
      return { redirectTo, flash: { type: 'error', message: 'Já existe alguém com esse nome na sua lista. Se forem xará, vale colocar um apelido para não virar bagunça.' } };
    }

    if (!normalizedPhone.ok) {
      return { redirectTo, flash: { type: 'error', message: normalizedPhone.reason || 'Não consegui entender esse telefone ainda. Confere o país e o número e tenta de novo.' } };
    }

    if (isSelfTarget && requestedSection === 'identity') {
      const availability = automationService.ensurePhoneAvailableForUser(userId, phone);
      if (!availability.ok) {
        return {
          redirectTo,
          flash: { type: 'error', message: availability.message || 'Esse telefone já está autorizado em outro usuário do AcerttaPay.' }
        };
      }
    }

    if (pixEnabled && requestedSection !== 'identity' && !pixProfile.valid) {
      return { redirectTo, flash: { type: 'error', message: pixProfile.reason || 'Faltou acertar um detalhe do Pix antes de salvar.' } };
    }

    const pixUpdatedAt = pixEnabled ? deps.nowIso() : null;
    const payload = {
      name,
      phone,
      email,
      pixEnabled,
      pixKeyType: storedPixProfile.keyType,
      pixKeyValue: storedPixProfile.keyValue || null,
      pixCity: storedPixProfile.city || null,
      pixState: storedPixProfile.state || deps.guessPixStateByCity(storedPixProfile.city) || null,
      pixLabel: storedPixProfile.label || null,
      pixUpdatedAt
    };

    if (id) {
      repository.updatePerson(userId, id, payload);
    } else {
      repository.createPerson(userId, payload);
    }

    const automationPhoneSync = isSelfTarget && requestedSection === 'identity'
      ? automationService.syncAuthorizationAfterSelfPhoneChange(userId, phone)
      : { disabled: false };

    let successMessage = 'Contato salvo direitinho por aqui. Quando rolar amizade e pagamento, o Pix vem do perfil da própria pessoa.';
    if (isSelfTarget) {
      if (requestedSection === 'identity') {
        successMessage = 'Seu perfil por aqui foi salvo direitinho.';
        if (automationPhoneSync.disabled) {
          successMessage += ' Como o telefone mudou, pausei o WhatsApp automático até você reativar por segurança.';
        }
      } else if (requestedSection === 'pix') {
        successMessage = pixEnabled
          ? 'Seu Pix ficou salvo e prontinho para entrar em cena nas cobranças.'
          : 'Seu Pix foi desligado por aqui. Quando quiser, é só ligar de novo.';
      } else {
        successMessage = pixEnabled
          ? 'Seu perfil foi salvo com o Pix prontinho para entrar em cena.'
          : 'Seu perfil foi atualizado direitinho por aqui.';
      }
    }

    return { redirectTo, flash: { type: 'success', message: successMessage } };
  }

  function sendFriendRequest({ userId, personId }) {
    const person = repository.getEditablePerson(userId, personId);
    if (!person) {
      return { redirectTo: '/people', flash: { type: 'error', message: 'Não encontrei essa pessoa por aqui.' } };
    }
    if (deps.isSelfPersonRow(person)) {
      return { redirectTo: '/people', flash: { type: 'info', message: 'Seu perfil já está no comando por aqui. Esse pedido não precisa existir.' } };
    }
    if (Number(person.active || 0) === 0) {
      return { redirectTo: '/people', flash: { type: 'info', message: 'Reative essa pessoa antes de mandar um pedido de amizade.' } };
    }

    const resolved = deps.getResolvedAppUserForPerson(userId, personId);
    if (!resolved?.linked_user_id) {
      return { redirectTo: '/people', flash: { type: 'info', message: 'Essa pessoa ainda não apareceu como usuária do AcerttaPay. Quando isso rolar, o botão vem pra festa.' } };
    }
    if (Number(resolved.linked_user_id || 0) === Number(userId || 0)) {
      return { redirectTo: '/people', flash: { type: 'info', message: 'Pedido para você mesmo não entra na fila.' } };
    }
    if (deps.getActiveFriendshipBetweenUsers(userId, resolved.linked_user_id)) {
      return { redirectTo: '/people', flash: { type: 'success', message: `${person.name} já está com amizade ativa por aqui.` } };
    }

    const incomingPending = deps.getPendingFriendRequestBetweenUsers(resolved.linked_user_id, userId);
    if (incomingPending) {
      return { redirectTo: `/people?friendRequest=${incomingPending.id}`, flash: { type: 'info', message: 'Boa! Essa pessoa já te mandou um pedido. É só aceitar para liberar as cobranças automáticas dos dois lados.' } };
    }

    const outgoingPending = deps.getPendingFriendRequestBetweenUsers(userId, resolved.linked_user_id);
    if (outgoingPending) {
      return { redirectTo: '/people', flash: { type: 'info', message: 'Esse pedido já foi enviado e está só esperando o outro lado dar o ok.' } };
    }

    const requester = deps.getUserRecord(userId);
    const targetUser = deps.getUserRecord(resolved.linked_user_id);
    const now = deps.nowIso();
    const info = repository.insertFriendRequest({
      requesterUserId: userId,
      targetUserId: resolved.linked_user_id,
      sourcePersonId: personId,
      requesterNameSnapshot: requester?.name || deps.getOwnerPerson(userId)?.name || requester?.email || 'Um usuário',
      requesterEmailSnapshot: deps.normalizeEmail(requester?.email),
      targetNameSnapshot: targetUser?.name || resolved.linked_user_name || person.name,
      targetEmailSnapshot: deps.normalizeEmail(targetUser?.email || resolved.linked_user_email || person.email),
      createdAt: now,
      updatedAt: now
    });

    const requestId = Number(info.lastInsertRowid || 0);
    const resolvedFriendRequestMessage = deps.resolveCatalogText('notification.friendship.request_received', {
      pessoa: requester?.name || person.name || 'Alguém'
    }, {
      fallbackTitle: 'Chegou um pedido de amizade',
      fallbackBody: `${requester?.name || person.name || 'Alguém'} quer virar seu contato de confiança no AcerttaPay.`
    });
    deps.createNotification({
      userId: resolved.linked_user_id,
      type: 'friend_request',
      title: resolvedFriendRequestMessage.title,
      body: resolvedFriendRequestMessage.body,
      href: `/people?friendRequest=${requestId}`,
      relatedType: 'friend_request',
      relatedId: requestId,
      groupKey: 'friendship_activity'
    });

    return { redirectTo: '/people', flash: { type: 'success', message: `Pedido enviado para ${person.name}. Agora é só esperar o outro lado dar o joinha.` } };
  }

  function cancelFriendRequest({ userId, requestId }) {
    const requestRow = deps.getPendingFriendRequestById(requestId);
    if (!requestRow || Number(requestRow.requester_user_id || 0) !== userId || deps.normalizeFriendRequestStatus(requestRow.status) !== 'pending') {
      return { redirectTo: '/people', flash: { type: 'info', message: 'Esse pedido já andou ou não existe mais.' } };
    }
    repository.cancelFriendRequest(userId, requestId, deps.nowIso());
    return { redirectTo: '/people', flash: { type: 'success', message: 'Pedido cancelado. Nada foi criado entre vocês.' } };
  }

  function respondFriendRequest({ userId, requestId, action }) {
    const requestRow = deps.getPendingFriendRequestById(requestId);
    if (!requestRow || Number(requestRow.target_user_id || 0) !== userId || deps.normalizeFriendRequestStatus(requestRow.status) !== 'pending') {
      return { redirectTo: '/people', flash: { type: 'info', message: 'Esse pedido já mudou de estado ou não existe mais.' } };
    }
    if (!['accept', 'reject'].includes(action)) {
      return { redirectTo: '/people', flash: { type: 'error', message: 'Não entendi a resposta desse pedido.' } };
    }

    const now = deps.nowIso();
    const requesterUser = deps.getUserRecord(requestRow.requester_user_id);
    const targetUser = deps.getUserRecord(requestRow.target_user_id);

    if (action === 'accept') {
      repository.withTransaction(() => {
        repository.acceptFriendRequest(userId, requestId, now);
        deps.closeOtherPendingFriendRequestsBetweenUsers(requestRow.requester_user_id, requestRow.target_user_id, requestId, 'merged');
        const friendship = deps.upsertFriendship({
          userAId: requestRow.requester_user_id,
          userBId: requestRow.target_user_id,
          status: 'active',
          originRequestId: requestId,
          source: 'friend_request'
        });

        if (Number(requestRow.source_person_id || 0) > 0) {
          deps.upsertPersonAppLink({
            ownerUserId: requestRow.requester_user_id,
            personId: requestRow.source_person_id,
            linkedUserId: requestRow.target_user_id,
            matchKind: 'friendship'
          });
        }

        deps.ensureFriendPersonForUser({
          ownerUserId: requestRow.target_user_id,
          remoteUserId: requestRow.requester_user_id,
          preferredName: requestRow.requester_name_snapshot || requesterUser?.name || requesterUser?.email,
          preferredEmail: requestRow.requester_email_snapshot || requesterUser?.email
        });

        const resolvedFriendAcceptedMessage = deps.resolveCatalogText('notification.friendship.request_accepted', {
          pessoa: targetUser?.name || 'Essa pessoa'
        }, {
          fallbackTitle: 'Amizade ativada',
          fallbackBody: `${targetUser?.name || 'Essa pessoa'} aceitou seu pedido. Agora vocês já podem trocar cobranças automáticas com mais privacidade.`
        });
        deps.createNotification({
          userId: requestRow.requester_user_id,
          type: 'friendship_update',
          title: resolvedFriendAcceptedMessage.title,
          body: resolvedFriendAcceptedMessage.body,
          href: '/people',
          relatedType: 'friend_request',
          relatedId: requestId,
          groupKey: 'friendship_activity'
        });
      });

      return { redirectTo: '/people', flash: { type: 'success', message: `${requestRow.requester_name || 'Pedido aceito'} entrou para sua rede. Os acertos automáticos entre vocês já estão liberados.` } };
    }

    repository.rejectFriendRequest(userId, requestId, now);
    const resolvedFriendRejectedMessage = deps.resolveCatalogText('notification.friendship.request_rejected', {
      pessoa: targetUser?.name || 'Essa pessoa'
    }, {
      fallbackTitle: 'Pedido não aceito',
      fallbackBody: `${targetUser?.name || 'Essa pessoa'} preferiu não ativar a amizade agora.`
    });
    deps.createNotification({
      userId: requestRow.requester_user_id,
      type: 'friendship_update',
      title: resolvedFriendRejectedMessage.title,
      body: resolvedFriendRejectedMessage.body,
      href: '/people',
      relatedType: 'friend_request',
      relatedId: requestId,
      groupKey: 'friendship_activity'
    });

    return { redirectTo: '/people', flash: { type: 'success', message: 'Pedido recusado. Nada mudou nas cobranças e a vida segue leve.' } };
  }

  function unfriend({ userId, personId }) {
    const person = repository.getEditablePerson(userId, personId);
    if (!person) return { redirectTo: '/people', flash: { type: 'error', message: 'Não encontrei essa pessoa por aqui.' } };
    if (deps.isSelfPersonRow(person)) {
      return { redirectTo: '/people', flash: { type: 'info', message: 'Seu perfil não entra nessa dança de amizade. Ele já é você por definição.' } };
    }

    const resolved = deps.getResolvedAppUserForPerson(userId, personId);
    if (!resolved?.linked_user_id) {
      return { redirectTo: '/people', flash: { type: 'info', message: 'Esse contato não está ligado a um usuário do app.' } };
    }

    const friendship = deps.getActiveFriendshipBetweenUsers(userId, resolved.linked_user_id);
    if (!friendship) {
      return { redirectTo: '/people', flash: { type: 'info', message: 'A amizade já não estava ativa.' } };
    }

    const now = deps.nowIso();
    repository.endFriendship(friendship.id, userId, now);
    deps.closeOtherPendingFriendRequestsBetweenUsers(userId, resolved.linked_user_id, null, 'merged');

    const actor = deps.getUserRecord(userId);
    const resolvedFriendEndedMessage = deps.resolveCatalogText('notification.friendship.ended', {
      pessoa: actor?.name || 'Um contato'
    }, {
      fallbackTitle: 'Amizade desfeita',
      fallbackBody: `${actor?.name || 'Um contato'} desfez a amizade no AcerttaPay. O histórico continua, mas novos envios automáticos param por aqui.`
    });
    deps.createNotification({
      userId: resolved.linked_user_id,
      type: 'friendship_update',
      title: resolvedFriendEndedMessage.title,
      body: resolvedFriendEndedMessage.body,
      href: '/people',
      relatedType: 'friendship',
      relatedId: friendship.id,
      groupKey: 'friendship_activity'
    });

    return { redirectTo: '/people', flash: { type: 'success', message: `Amizade com ${person.name} desfeita. O histórico ficou salvo, mas novos envios automáticos param daqui pra frente.` } };
  }

  function togglePerson({ userId, personId }) {
    const person = repository.getEditablePerson(userId, personId);
    if (!person) return { redirectTo: '/people', flash: { type: 'error', message: 'Não encontrei essa pessoa por aqui.' } };
    if (deps.isSelfPersonRow(person)) {
      return { redirectTo: '/people', flash: { type: 'info', message: 'Seu perfil fica sempre ativo por aqui. O que dá para ajustar nele são seus dados e seu Pix.' } };
    }

    const becameActive = Number(person.active || 0) === 0;
    repository.togglePerson(userId, personId, becameActive);
    return {
      redirectTo: '/people',
      flash: {
        type: 'success',
        message: becameActive
          ? `${person.name} voltou para sua lista ativa.`
          : `${person.name} foi tirado(a) de cena sem mexer no histórico.`
      }
    };
  }

  function deletePerson({ userId, personId }) {
    const person = repository.getEditablePerson(userId, personId);
    if (!person) return { redirectTo: '/people', flash: { type: 'error', message: 'Pessoa não encontrada.' } };
    if (deps.isSelfPersonRow(person)) {
      return { redirectTo: '/people', flash: { type: 'info', message: 'Seu perfil não pode ser excluído daqui. Ele é a base da sua conta e dos seus acertos.' } };
    }

    const blockers = deps.getContactDeletionBlockers(userId, personId);
    if (blockers.openBalanceMonths.length > 0) {
      const firstOpenMonth = blockers.openBalanceMonths[0];
      const extraMonths = blockers.openBalanceMonths.length - 1;
      const monthText = deps.monthLabel(firstOpenMonth.month, firstOpenMonth.year);
      return {
        redirectTo: '/people',
        flash: {
          type: 'info',
          message: `${person.name} ainda tem valor em aberto em ${monthText}${extraMonths > 0 ? ` e em mais ${extraMonths} ${extraMonths === 1 ? 'mês' : 'meses'}` : ''}. Antes de excluir da sua lista, precisamos fechar essas pendências.`
        }
      };
    }
    if (blockers.hasDraftQueue) {
      return { redirectTo: '/people', flash: { type: 'info', message: `${person.name} ainda está em uma caixa de saída de acertos. Envie ou descarte esse rascunho antes de excluir da sua lista.` } };
    }
    if (blockers.hasOpenPixIntent) {
      return { redirectTo: '/people', flash: { type: 'info', message: `${person.name} ainda tem um Pix do mês aguardando andamento. Fecha esse fluxo primeiro e depois a exclusão fica liberada.` } };
    }
    if (blockers.hasOpenRequests) {
      return { redirectTo: '/people', flash: { type: 'info', message: `${person.name} ainda participa de acertos em aberto. Resolve isso primeiro e depois eu libero a exclusão sem apagar o passado.` } };
    }

    try {
      deps.offboardContactFromActiveExperience(userId, personId);
      return { redirectTo: '/people', flash: { type: 'success', message: `${person.name} saiu da sua lista ativa. O histórico ficou salvo, e se um dia voltar pode entrar como novo contato.` } };
    } catch (err) {
      return { redirectTo: '/people', flash: { type: 'error', message: deps.getFriendlyErrorMessage(err, { defaultMessage: `Não consegui excluir ${person.name} agora.` }) } };
    }
  }

  function setOwner() {
    return { redirectTo: '/people', flash: { type: 'info', message: 'Agora seu perfil já é fixo por aqui. Não precisa mais trocar quem é você.' } };
  }

  return {
    getPeoplePageViewModel,
    uploadProfilePhoto,
    useDefaultProfilePhoto,
    removeProfilePhoto,
    redirectComprasComigo,
    getComprasComigoPage,
    createComprasComigoChargeDraft,
    saveNotificationPreferences,
    enableWhatsappAutomation,
    disableWhatsappAutomation,
    savePerson,
    sendFriendRequest,
    cancelFriendRequest,
    respondFriendRequest,
    unfriend,
    togglePerson,
    deletePerson,
    setOwner
  };
}

module.exports = {
  createPeopleService
};
