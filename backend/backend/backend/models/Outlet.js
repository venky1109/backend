// models/Outlet.js
import mongoose from 'mongoose';

const outletSchema = new mongoose.Schema({
  name: { type: String, required: true }, // Optional: Outlet name
  supportedPincodes: [{ type: String }], // Direct pincode coverage
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true }, // [longitude, latitude]
  },
  radiusKm: { type: Number, default: 20 }, // Service radius in KM
});

outletSchema.index({ location: '2dsphere' });

const Outlet = mongoose.model('Outlet', outletSchema);
export default Outlet;
