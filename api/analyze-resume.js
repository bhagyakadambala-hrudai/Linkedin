const path = require('path');
const { analyzeResumeFromUrl } = require(path.join(__dirname, '..', 'lib', 'analyzeResumeOpenAI.cjs'));

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ success: false, role: '', skills: [], topics: [] });
    }

    const body = typeof req.body === 'object' && req.body ? req.body : null;
    console.log('Incoming request:', body);

    if (!body || !body.fileUrl || typeof body.fileUrl !== 'string' || !body.fileUrl.trim()) {
      return res.status(200).json({
        success: false,
        role: '',
        skills: [],
        topics: [],
      });
    }

    const result = await analyzeResumeFromUrl(body.fileUrl.trim());
    const payload = {
      success: result.success === true,
      role: result.role || '',
      skills: Array.isArray(result.skills) ? result.skills : [],
      topics: Array.isArray(result.topics) ? result.topics : [],
    };
    if (result.error) {
      payload.error = result.error;
    }
    return res.status(200).json(payload);
  } catch (error) {
    console.error('Analyze Resume Error:', error);
    return res.status(200).json({
      success: false,
      role: '',
      skills: [],
      topics: [],
    });
  }
};
