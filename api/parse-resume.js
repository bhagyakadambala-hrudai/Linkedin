const path = require('path');
const { fetchAndExtractText } = require(path.join(__dirname, '..', 'lib', 'resumePipeline.cjs'));

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'object' && req.body ? req.body : {};
    const fileUrl = body.fileUrl;
    if (!fileUrl || typeof fileUrl !== 'string') {
      return res.status(400).json({ error: 'fileUrl is required' });
    }

    const text = await fetchAndExtractText(fileUrl.trim());
    return res.status(200).json({ text });
  } catch (err) {
    console.error('[parse-resume]', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to parse resume',
    });
  }
};
