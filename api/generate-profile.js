const path = require('path');
const { generateProfileFromText } = require(path.join(
  __dirname,
  '..',
  'lib',
  'generateProfileFromText.cjs'
));

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'object' && req.body ? req.body : {};
    const text = body.text;
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'text is required' });
    }

    const profile = await generateProfileFromText(text.trim());
    return res.status(200).json(profile);
  } catch (err) {
    console.error('[generate-profile]', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to generate profile',
    });
  }
};
