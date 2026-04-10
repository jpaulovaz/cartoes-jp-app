function createPeopleRepository(deps = {}) {
  const { db } = deps;

  function withTransaction(fn) {
    return db.transaction(fn)();
  }

  function getEditablePerson(userId, personId) {
    return db.prepare(`
      SELECT id, name, phone, email,
             COALESCE(active, 1) AS active,
             COALESCE(is_owner, 0) AS is_owner,
             COALESCE(pix_enabled, 0) AS pix_enabled,
             pix_key_type,
             pix_key_value,
             pix_city,
             pix_state,
             pix_label,
             COALESCE(profile_kind, CASE WHEN COALESCE(is_owner, 0) = 1 THEN 'self' ELSE 'contact' END) AS profile_kind,
             COALESCE(status, CASE WHEN COALESCE(active, 1) = 0 THEN 'inactive' ELSE 'active' END) AS status
      FROM people
      WHERE id = ? AND user_id = ?
        AND COALESCE(status, CASE WHEN COALESCE(active, 1) = 0 THEN 'inactive' ELSE 'active' END) <> 'deleted'
      LIMIT 1
    `).get(personId, userId);
  }

  function updateUserProfilePhoto(userId, profilePhotoUrl, profilePhotoMode) {
    return db.prepare(`
      UPDATE users
      SET profile_photo_url = ?, profile_photo_mode = ?
      WHERE id = ?
    `).run(profilePhotoUrl, profilePhotoMode, userId);
  }

  function updateUserProfileSignature(userId, profileSignatureText, profileSignatureVibe, profileSignatureUpdatedAt) {
    return db.prepare(`
      UPDATE users
      SET profile_signature_text = ?,
          profile_signature_vibe = ?,
          profile_signature_updated_at = ?
      WHERE id = ?
    `).run(profileSignatureText || null, profileSignatureVibe || null, profileSignatureUpdatedAt || null, userId);
  }

  function updatePerson(userId, personId, payload = {}) {
    return db.prepare(`
      UPDATE people
      SET name = ?,
          phone = ?,
          email = ?,
          pix_enabled = ?,
          pix_key_type = ?,
          pix_key_value = ?,
          pix_city = ?,
          pix_state = ?,
          pix_label = ?,
          pix_updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(
      payload.name,
      payload.phone,
      payload.email,
      payload.pixEnabled ? 1 : 0,
      payload.pixKeyType,
      payload.pixKeyValue || null,
      payload.pixCity || null,
      payload.pixState || null,
      payload.pixLabel || null,
      payload.pixUpdatedAt || null,
      personId,
      userId
    );
  }

  function createPerson(userId, payload = {}) {
    return db.prepare(`
      INSERT INTO people(
        user_id, name, phone, email, pix_enabled, pix_key_type,
        pix_key_value, pix_city, pix_state, pix_label, pix_updated_at, active, is_owner, profile_kind, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 'contact', 'active')
    `).run(
      userId,
      payload.name,
      payload.phone,
      payload.email,
      payload.pixEnabled ? 1 : 0,
      payload.pixKeyType,
      payload.pixKeyValue || null,
      payload.pixCity || null,
      payload.pixState || null,
      payload.pixLabel || null,
      payload.pixUpdatedAt || null
    );
  }

  function insertFriendRequest(payload = {}) {
    return db.prepare(`
      INSERT INTO friend_requests (
        requester_user_id, target_user_id, source_person_id,
        requester_name_snapshot, requester_email_snapshot,
        target_name_snapshot, target_email_snapshot,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(
      payload.requesterUserId,
      payload.targetUserId,
      payload.sourcePersonId,
      payload.requesterNameSnapshot,
      payload.requesterEmailSnapshot,
      payload.targetNameSnapshot,
      payload.targetEmailSnapshot,
      payload.createdAt,
      payload.updatedAt
    );
  }

  function cancelFriendRequest(userId, requestId, now) {
    return db.prepare(`
      UPDATE friend_requests
      SET status = 'cancelled_by_requester', updated_at = ?, responded_at = COALESCE(responded_at, ?), resolved_at = COALESCE(resolved_at, ?)
      WHERE id = ? AND requester_user_id = ? AND status = 'pending'
    `).run(now, now, now, requestId, userId);
  }

  function acceptFriendRequest(userId, requestId, now) {
    return db.prepare(`
      UPDATE friend_requests
      SET status = 'accepted', updated_at = ?, responded_at = COALESCE(responded_at, ?), resolved_at = COALESCE(resolved_at, ?)
      WHERE id = ? AND target_user_id = ? AND status = 'pending'
    `).run(now, now, now, requestId, userId);
  }

  function rejectFriendRequest(userId, requestId, now) {
    return db.prepare(`
      UPDATE friend_requests
      SET status = 'rejected', updated_at = ?, responded_at = COALESCE(responded_at, ?), resolved_at = COALESCE(resolved_at, ?)
      WHERE id = ? AND target_user_id = ? AND status = 'pending'
    `).run(now, now, now, requestId, userId);
  }

  function endFriendship(friendshipId, userId, now) {
    return db.prepare(`
      UPDATE friendships
      SET status = 'ended', updated_at = ?, ended_at = ?, ended_by_user_id = ?
      WHERE id = ? AND status = 'active'
    `).run(now, now, userId, friendshipId);
  }

  function togglePerson(userId, personId, becameActive) {
    return db.prepare(`
      UPDATE people
      SET active = ?,
          status = ?,
          deleted_at = CASE WHEN ? = 1 THEN NULL ELSE deleted_at END
      WHERE id = ? AND user_id = ?
        AND COALESCE(status, CASE WHEN COALESCE(active, 1) = 0 THEN 'inactive' ELSE 'active' END) <> 'deleted'
    `).run(becameActive ? 1 : 0, becameActive ? 'active' : 'inactive', becameActive ? 1 : 0, personId, userId);
  }

  return {
    withTransaction,
    getEditablePerson,
    updateUserProfilePhoto,
    updateUserProfileSignature,
    updatePerson,
    createPerson,
    insertFriendRequest,
    cancelFriendRequest,
    acceptFriendRequest,
    rejectFriendRequest,
    endFriendship,
    togglePerson
  };
}

module.exports = {
  createPeopleRepository
};
