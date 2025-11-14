const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(cors());

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'FFmpeg Video Merger API is running!',
    version: '1.0.0',
    endpoints: {
      merge: 'POST /merge',
      health: 'GET /health'
    }
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Main merge endpoint
app.post('/merge', async (req, res) => {
  const { videoUrl, audioUrl } = req.body;
  
  console.log('=== Merge Request Received ===');
  console.log('Video URL:', videoUrl);
  console.log('Audio URL:', audioUrl);
  
  if (!videoUrl || !audioUrl) {
    return res.status(400).json({ 
      error: 'Missing required fields',
      required: ['videoUrl', 'audioUrl']
    });
  }
  
  const startTime = Date.now();
  let videoPath, audioPath, outputPath;
  
  try {
    // Create temp directory
    const tempDir = '/tmp';
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(7);
    
    videoPath = path.join(tempDir, `video_${timestamp}_${randomId}.mp4`);
    audioPath = path.join(tempDir, `audio_${timestamp}_${randomId}.mp3`);
    outputPath = path.join(tempDir, `output_${timestamp}_${randomId}.mp4`);
    
    console.log('Temp files:', { videoPath, audioPath, outputPath });
    
    // Download video
    console.log('Downloading video...');
    const videoResponse = await axios.get(videoUrl, { 
      responseType: 'stream',
      timeout: 60000,
      maxContentLength: 50 * 1024 * 1024
    });
    
    const videoWriter = fs.createWriteStream(videoPath);
    videoResponse.data.pipe(videoWriter);
    
    await new Promise((resolve, reject) => {
      videoWriter.on('finish', resolve);
      videoWriter.on('error', reject);
    });
    
    const videoSize = fs.statSync(videoPath).size;
    console.log(`Video downloaded: ${(videoSize / 1024 / 1024).toFixed(2)} MB`);
    
    // Download audio
    console.log('Downloading audio...');
    const audioResponse = await axios.get(audioUrl, { 
      responseType: 'stream',
      timeout: 30000,
      maxContentLength: 10 * 1024 * 1024
    });
    
    const audioWriter = fs.createWriteStream(audioPath);
    audioResponse.data.pipe(audioWriter);
    
    await new Promise((resolve, reject) => {
      audioWriter.on('finish', resolve);
      audioWriter.on('error', reject);
    });
    
    const audioSize = fs.statSync(audioPath).size;
    console.log(`Audio downloaded: ${(audioSize / 1024 / 1024).toFixed(2)} MB`);
    
    // Merge with FFmpeg
    console.log('Starting FFmpeg merge...');
    
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(videoPath)
        .input(audioPath)
        .outputOptions([
          '-c:v copy',
          '-c:a aac',
          '-b:a 192k',
          '-map 0:v:0',
          '-map 1:a:0',
          '-shortest',
          '-movflags +faststart',
          '-y'
        ])
        .output(outputPath)
        .on('start', (cmd) => {
          console.log('FFmpeg command:', cmd);
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(`Progress: ${progress.percent.toFixed(1)}%`);
          }
        })
        .on('end', () => {
          console.log('FFmpeg merge complete!');
          resolve();
        })
        .on('error', (err, stdout, stderr) => {
          console.error('FFmpeg error:', err.message);
          console.error('FFmpeg stderr:', stderr);
          reject(new Error(`FFmpeg error: ${err.message}`));
        })
        .run();
    });
    
    // Check output file
    if (!fs.existsSync(outputPath)) {
      throw new Error('Output file was not created');
    }
    
    const outputSize = fs.statSync(outputPath).size;
    console.log(`Merged video size: ${(outputSize / 1024 / 1024).toFixed(2)} MB`);
    
    // Read merged video as base64
    console.log('Converting to base64...');
    const mergedVideo = fs.readFileSync(outputPath);
    const base64Video = mergedVideo.toString('base64');
    
    const processingTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`Total processing time: ${processingTime}s`);
    
    // Cleanup temp files
    console.log('Cleaning up temp files...');
    try {
      if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
      if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    } catch (cleanupError) {
      console.error('Cleanup error:', cleanupError);
    }
    
    console.log('=== Merge Success ===');
    
    res.json({ 
      success: true,
      base64: base64Video,
      stats: {
        inputVideoSize: videoSize,
        inputAudioSize: audioSize,
        outputSize: outputSize,
        processingTime: parseFloat(processingTime),
        outputSizeMB: (outputSize / 1024 / 1024).toFixed(2)
      },
      message: 'Video and audio merged successfully'
    });
    
  } catch (error) {
    console.error('=== Merge Error ===');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    
    // Cleanup on error
    try {
      if (videoPath && fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
      if (audioPath && fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
      if (outputPath && fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    } catch (cleanupError) {
      console.error('Cleanup error:', cleanupError);
    }
    
    res.status(500).json({ 
      success: false,
      error: error.message,
      details: error.stack
    });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🚀 FFmpeg Video Merger API running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🎬 FFmpeg path: ${ffmpegPath}`);
});