Admin clicks Delete on "Jane Doe"
         ↓
Row stays in DB — tombstone
email    → deleted-a1b2c3d4@purged.local
username → deleted-a1b2c3d4  
password → random bcrypt (unloginnable)
phone    → NULL
bio      → NULL
avatar   → NULL
mfa      → disabled
status   → DELETED
isActive → false
deleted_at → NOW()
fullName → "Jane Doe" ✅ kept forever
         ↓
@SQLRestriction hides her from all app queries
Audit logs still show "Jane Doe" ✅
Sessions/vehicles/uploads still linked ✅
She can never login ✅
GDPR PII erased ✅