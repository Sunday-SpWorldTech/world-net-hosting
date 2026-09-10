const mongoose = require('mongoose');

const staffSupportNoteSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  staff: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  staffEmail: { type: String, trim: true, default: '' },
  kind: { type: String, enum: ['note','follow_up','escalation','security'], default: 'note' },
  body: { type: String, required: true, trim: true, maxlength: 2000 }
}, { timestamps: true });

module.exports = mongoose.model('StaffSupportNote', staffSupportNoteSchema);
