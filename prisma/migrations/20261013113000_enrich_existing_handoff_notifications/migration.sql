-- Bring legacy handoff notices to the same useful format as new notices.
UPDATE "Notification" AS notification
SET "body" =
  'المراجع: ' || patient."fullName" || E'\nالوجهة: ' ||
  CASE handoff."toRole"
    WHEN 'SECRETARY' THEN 'سكرتارية المركز'
    WHEN 'RESIDENT' THEN 'طبيب مقيم'
    WHEN 'DOCTOR' THEN 'طبيب اختصاص'
    WHEN 'HEAD_THERAPIST' THEN 'رئيس المعالجين'
    WHEN 'THERAPIST' THEN 'معالج'
    WHEN 'RECEPTION' THEN 'الاستقبال'
    WHEN 'DATA_ENTRY' THEN 'إدخال البيانات'
    ELSE handoff."toRole"::text
  END || COALESCE(' - ' || center."name", '') ||
  E'\nرقم التحويلة: ' || handoff."id"
FROM "patient_handoffs" AS handoff
JOIN "patients" AS patient ON patient."id" = handoff."patientId"
LEFT JOIN "centers" AS center ON center."id" = handoff."toCenterId"
WHERE notification."handoffId" = handoff."id"
  AND notification."body" = ('رقم التسليم: ' || handoff."id");
