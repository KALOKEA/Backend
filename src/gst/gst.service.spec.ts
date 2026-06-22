import { GstService } from './gst.service';

/**
 * Pure-math unit tests for the GST engine. These helpers don't touch the DB or
 * settings, so the service is instantiated with null deps. All money is paise.
 */
describe('GstService — pure GST math', () => {
  const gst = new GstService(null as any, null as any);

  describe('taxOn', () => {
    it('computes exclusive GST in paise, rounded', () => {
      expect(gst.taxOn(100000, 12)).toBe(12000); // ₹1000 @ 12% = ₹120
      expect(gst.taxOn(99900, 5)).toBe(4995);    // ₹999  @ 5%
      expect(gst.taxOn(0, 12)).toBe(0);
    });
  });

  describe('splitTax', () => {
    it('intra-state: CGST + SGST sum EXACTLY to the tax (odd amounts too)', () => {
      const { cgst, sgst, igst } = gst.splitTax(12001, true);
      expect(igst).toBe(0);
      expect(cgst + sgst).toBe(12001);
    });

    it('inter-state: whole tax goes to IGST', () => {
      const { cgst, sgst, igst } = gst.splitTax(12000, false);
      expect(cgst).toBe(0);
      expect(sgst).toBe(0);
      expect(igst).toBe(12000);
    });

    it('preserves the sum for negative (refund) amounts', () => {
      const { cgst, sgst } = gst.splitTax(-1001, true);
      expect(cgst + sgst).toBe(-1001);
    });
  });

  describe('garmentSlabRate', () => {
    it('is 5% below ₹1000 and 12% at/above ₹1000', () => {
      expect(gst.garmentSlabRate(99900)).toBe(5);
      expect(gst.garmentSlabRate(100000)).toBe(12);
      expect(gst.garmentSlabRate(250000)).toBe(12);
    });
  });

  describe('isIntraState', () => {
    it('matches case-insensitively and trims; empty never matches', () => {
      expect(gst.isIntraState('Maharashtra', 'maharashtra ')).toBe(true);
      expect(gst.isIntraState('Gujarat', 'Maharashtra')).toBe(false);
      expect(gst.isIntraState('', 'Maharashtra')).toBe(false);
      expect(gst.isIntraState('Maharashtra', '')).toBe(false);
    });
  });

  describe('resolveRate', () => {
    it('uses the product rate when positive, else the default', () => {
      expect(gst.resolveRate(18, 12)).toBe(18);
      expect(gst.resolveRate(0, 12)).toBe(12);
      expect(gst.resolveRate(null, 5)).toBe(5);
      expect(gst.resolveRate(undefined, 12)).toBe(12);
    });
  });
});
