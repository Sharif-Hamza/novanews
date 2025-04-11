const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const cheerio = require('cheerio');
const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const path = require('path');

// Load environment variables from the root .env file
dotenv.config({ path: path.resolve(__dirname, '../.env') });
console.log('Loading environment variables from:', path.resolve(__dirname, '../.env'));

// Check if all needed environment variables are available at startup
const checkEnvironmentVariables = () => {
  const requiredVars = [
    'SUPABASE_URL',
    'SUPABASE_KEY',
    'DEEPSEEK_KEY',
    'NEWS_API_KEY',
    'CRYPTOPANIC_KEY',
    'ALPHA_VANTAGE_KEY'
  ];
  
  const missingVars = requiredVars.filter(name => !process.env[name]);
  
  if (missingVars.length > 0) {
    console.error('ERROR: The following required environment variables are missing:', missingVars.join(', '));
    console.error('Please check your .env file and ensure all required variables are set.');
    return false;
  }
  
  console.log('All required environment variables are loaded successfully!');
  return true;
};

// Explicitly set configuration from environment variables
const config = {
  supabase: {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_KEY
  },
  deepseekKey: process.env.DEEPSEEK_KEY,
  replicateKey: process.env.REPLICATE_KEY || '',
  newsApiKey: process.env.NEWS_API_KEY,
  cryptopanicKey: process.env.CRYPTOPANIC_KEY,
  alphaVantageKey: process.env.ALPHA_VANTAGE_KEY
};

// Initialize Supabase client with service role
console.log('Initializing Supabase client with:', { 
  URL: config.supabase.url ? '✓' : 'missing', 
  KEY: config.supabase.key ? '✓' : 'missing'
});

const supabase = createClient(
  config.supabase.url,
  config.supabase.key,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

// Set the service role for auth-required operations
// This ensures reactions will work properly with RLS
const serviceRoleHeaders = {
  global: {
    headers: {
      Authorization: `Bearer ${config.supabase.key}`
    }
  }
};

// Apply service role headers to supabase client
supabase.headers = serviceRoleHeaders.global.headers;

const app = express();
const port = 3001; // Using port 3001 consistently

// Add CORS support - enable for all origins during development
app.use(cors({
  origin: '*', // Allow all origins for development
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'Cache-Control', 'X-Auth-Token', 'pragma'],
  exposedHeaders: ['Content-Length', 'X-Foo', 'X-Bar'],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204,
  maxAge: 86400
}));

// CORS middleware for additional security
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, Cache-Control');
  next();
});

// Set up JSON parsing middleware
app.use(express.json());

// Test route
app.get('/', (req, res) => {
  res.json({ message: 'Fentrix.AI News API is running' });
});

// Meta information endpoint
app.get('/meta.json', (req, res) => {
  res.json({
    name: 'Fentrix.AI News',
    version: '1.0.0',
    apiStatus: 'online',
    endpoints: [
      '/api/article-count',
      '/api/check-articles',
      '/api/news',
      '/api/stocks',
      '/api/crypto',
      '/api/crypto-news',
      '/api/lifecycle-status'
    ]
  });
});

// Diagnostic endpoint to check article count
app.get('/api/article-count', async (req, res) => {
  try {
    // Count articles in the database
    const { count, error } = await supabase
      .from('articles')
      .select('*', { count: 'exact', head: true });
    
    if (error) {
      console.error('Error counting articles:', error);
      return res.status(500).json({ error: error.message });
    }
    
    // Get the latest articles
    const { data: latestArticles, error: fetchError } = await supabase
      .from('articles')
      .select('id, title, category, created_at')
      .order('created_at', { ascending: false })
      .limit(5);
    
    if (fetchError) {
      console.error('Error fetching latest articles:', fetchError);
    }
    
    // Use the global next scheduled update time
    const now = new Date();
    
    // If the next scheduled time is not set or is in the past, calculate a new one
    if (!nextScheduledUpdateTime || nextScheduledUpdateTime < now) {
      nextScheduledUpdateTime = calculateNextUpdateTime();
      console.log(`Next scheduled update time was unset or passed, calculated new one: ${nextScheduledUpdateTime.toISOString()}`);
    } else {
      console.log(`Using existing next scheduled update time: ${nextScheduledUpdateTime.toISOString()}`);
    }
    
    // Calculate time remaining in more friendly format
    const timeDiff = nextScheduledUpdateTime.getTime() - now.getTime();
    const hoursRemaining = Math.floor(timeDiff / (1000 * 60 * 60));
    const minutesRemaining = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
    const secondsRemaining = Math.floor((timeDiff % (1000 * 60)) / 1000);
    
    // Log the next update time for debugging
    console.log(`Current time: ${now.toISOString()}`);
    console.log(`Next article update time: ${nextScheduledUpdateTime.toISOString()}`);
    console.log(`Time until next update: ${hoursRemaining}h ${minutesRemaining}m ${secondsRemaining}s`);
    
    res.json({ 
      articleCount: count,
      latestArticles: latestArticles || [],
      nextUpdateTime: nextScheduledUpdateTime.toISOString(),
      timeRemaining: {
        hours: hoursRemaining,
        minutes: minutesRemaining,
        seconds: secondsRemaining,
        totalSeconds: Math.floor(timeDiff / 1000)
      },
      currentTime: now.toISOString(),
      updateScheduleInfo: {
        frequency: "Every 4 hours",
        schedule: "12am, 4am, 8am, 12pm, 4pm, 8pm",
        timezone: "UTC"
      }
    });
  } catch (error) {
    console.error('Error in article-count endpoint:', error);
    res.status(500).json({ error: error.message });
  }
});

// Diagnostic endpoint to check articles are being stored
app.get('/api/check-articles', async (req, res) => {
  try {
    // Count articles in the database
    const { count, error: countError } = await supabase
      .from('articles')
      .select('*', { count: 'exact', head: true });
    
    if (countError) {
      console.error('Error counting articles:', countError);
      return res.status(500).json({ 
        error: countError.message,
        message: 'Error counting articles'
      });
    }
    
    // Get the latest 5 articles
    const { data: articles, error: fetchError } = await supabase
      .from('articles')
      .select('id, title, category, created_at, created_by')
      .order('created_at', { ascending: false })
      .limit(5);
    
    if (fetchError) {
      console.error('Error fetching articles:', fetchError);
      return res.status(500).json({ 
        error: fetchError.message,
        message: 'Error fetching articles' 
      });
    }
    
    // Check if Realtime is enabled on the Supabase project
    const { data: realtimeConfig, error: realtimeError } = await supabase.rpc('get_realtime_config').catch(err => {
      return { data: null, error: { message: 'Realtime config check failed: ' + err.message } };
    });
    
    res.json({
      articleCount: count,
      latestArticles: articles || [],
      realtimeConfig: realtimeConfig || { note: 'Could not check realtime config' },
      realtimeError: realtimeError ? realtimeError.message : null,
      databaseInfo: {
        url: config.supabase.url,
        connected: true,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Unexpected error in check-articles endpoint:', error);
    res.status(500).json({ 
      error: error.message || String(error),
      message: 'Unexpected error checking articles' 
    });
  }
});

// Helper function to generate AI content using DeepSeek
async function generateAIContent(title, content, category) {
  // Create a prompt tailored to the category
  let systemPrompt = "";
  
  switch(category) {
    case 'stock':
      systemPrompt = `You are a professional financial news journalist specializing in stock market analysis. 
      Generate a comprehensive, well-structured news article based on the provided content. 
      Include a catchy title, an informative summary, and a detailed body with the following sections:
      - Market Impact (how this news affects the stock market)
      - Expert Analysis (what financial experts are saying)
      - Forward Outlook (predictions and future implications)
      - Key Takeaways for investors
      
      The article MUST be at least 1000 words long with detailed analysis and examples.
      Use professional financial terminology, include specific stock symbols where relevant, and provide context for retail investors.`;
      break;
    
    case 'crypto':
      systemPrompt = `You are a blockchain technology expert and cryptocurrency journalist.
      Create a detailed news article based on the provided content.
      Include a catchy title, an informative summary, and a detailed body with the following sections:
      - Market Impact (how this news affects crypto prices)
      - Technical Analysis (relevant blockchain or technical aspects)
      - Community Response (reaction from the crypto community)
      - Future Implications (what this means for the crypto ecosystem)
      
      The article MUST be at least 1000 words long with detailed analysis and examples.
      Use appropriate crypto terminology, reference specific cryptocurrencies and tokens, and explain concepts clearly for both novice and experienced crypto enthusiasts.`;
      break;
    
    case 'health':
      systemPrompt = `You are a health and medical journalist with expertise in translating complex medical information for the general public.
      Write an informative health news article based on the provided content.
      Include a clear title, a concise summary, and a detailed body with the following sections:
      - Key Health Findings
      - Expert Medical Opinions
      - Practical Implications for Readers
      - Recommendations (if applicable)
      
      The article MUST be at least 1000 words long with detailed examples and medical context.
      Present information accurately with appropriate health terminology, balanced reporting of risks and benefits, and context that helps readers understand the significance of the information.`;
      break;
    
    case 'finance':
      systemPrompt = `You are a financial journalist with expertise in economics and business news.
      Create a detailed financial news article based on the provided content.
      Include an engaging title, a comprehensive summary, and a detailed body with the following sections:
      - Economic Context
      - Business Impact
      - Expert Analysis
      - Future Outlook
      
      The article MUST be at least 1000 words long with detailed analysis and examples.
      Use appropriate financial terminology, provide relevant economic context, and explain the implications for businesses and consumers.`;
      break;
    
    default:
      systemPrompt = `You are a professional news editor. Generate a well-structured news article based on the provided content. Include a title, summary, and detailed body with relevant sections, facts, and analysis. The article MUST be at least 1000 words long.`;
  }

  const response = await axios.post(
    'https://api.deepseek.com/v1/chat/completions',
    {
      model: 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: `Please create a comprehensive news article (at least 1000 words) based on this content: ${title}\n\n${content}`,
        },
      ],
      max_tokens: 3000,  // Increased to 3000 for much longer articles
    },
    {
      headers: {
        'Authorization': `Bearer ${config.deepseekKey}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return response.data.choices[0].message.content;
}

// Updated function to generate a cover image, with reliable fallback
async function generateCoverImage(title, category) {
  try {
    console.log(`Generating image for: ${title}`);
    
    // Clean the title for image generation
    const cleanTitle = title
      .replace(/#+\s*\*+/g, '')
      .replace(/\*\*/g, '')
      .replace(/:$/g, '')
      .trim();
    
    // Extract keywords from title for better image search
    const keywords = extractKeywords(cleanTitle, category);
    console.log('Image search keywords:', keywords);
    
    // Try Pexels API for high-quality free images
    try {
      // Note: You need to sign up for a free Pexels API key at https://www.pexels.com/api/
      // Then add PEXELS_API_KEY to your .env file
      const pexelsApiKey = process.env.PEXELS_API_KEY || '';
      
      if (pexelsApiKey) {
        const searchTerm = keywords.join(' ');
        const pexelsUrl = `https://api.pexels.com/v1/search?query=${encodeURIComponent(searchTerm)}&per_page=1&orientation=landscape`;
        
        const pexelsResponse = await axios.get(pexelsUrl, {
          headers: {
            'Authorization': pexelsApiKey
          }
        });
        
        if (pexelsResponse.data && pexelsResponse.data.photos && pexelsResponse.data.photos.length > 0) {
          // Get a random photo from the results
          const randomIndex = Math.floor(Math.random() * pexelsResponse.data.photos.length);
          const photo = pexelsResponse.data.photos[randomIndex];
          return photo.src.large; // Return the image URL
        }
      }
      
      throw new Error('No image found from Pexels');
    } catch (pexelsError) {
      console.error('Pexels image search failed:', pexelsError.message);
      // Fall through to next option
    }
    
    // Try Replicate if available
    try {
      if (config.replicateKey) {
        const prompt = `news article cover image about: ${keywords.join(' ')}`;
        const negativePrompt = "text, watermark, logo, label";
        
  const response = await axios.post(
    'https://api.replicate.com/v1/predictions',
    {
            version: "db21e45d3f7023abc2a46ee38a23973f6dce16bb082a930b0c49861f96d1e5bf",
      input: {
              prompt,
              negative_prompt: negativePrompt
            }
    },
    {
      headers: {
              'Authorization': `Token ${config.replicateKey}`,
        'Content-Type': 'application/json',
            }
          }
        );
        
        // Check if we got a successful response
        if (response.data && response.data.urls && response.data.urls.get) {
          // Poll for completion
          const getUrl = response.data.urls.get;
          let result = null;
          let attempts = 0;
          
          while (!result && attempts < 30) {
            const getResponse = await axios.get(getUrl, {
              headers: {
                'Authorization': `Token ${config.replicateKey}`,
                'Content-Type': 'application/json',
              }
            });
            
            if (getResponse.data.status === 'succeeded' && getResponse.data.output) {
              result = getResponse.data.output;
              break;
            }
            
            // Wait before polling again
            await new Promise(resolve => setTimeout(resolve, 1000));
            attempts++;
          }
          
          if (result && result.length > 0) {
            return result[0]; // Return the first image URL
          }
        }
      }
      
      throw new Error('No image generated from Replicate');
    } catch (replicateError) {
      console.error('Replicate image generation failed:', replicateError.message);
      // Fall through to fallback
    }
    
    // Try Unsplash API if available
    try {
      // Note: You need to sign up for a free Unsplash API key at https://unsplash.com/developers
      // Then add UNSPLASH_ACCESS_KEY to your .env file
      const unsplashApiKey = process.env.UNSPLASH_ACCESS_KEY || '';
      
      if (unsplashApiKey) {
        const searchTerm = keywords.join(' ');
        const unsplashUrl = `https://api.unsplash.com/photos/random?query=${encodeURIComponent(searchTerm)}&orientation=landscape`;
        
        const unsplashResponse = await axios.get(unsplashUrl, {
          headers: {
            'Authorization': `Client-ID ${unsplashApiKey}`
          }
        });
        
        if (unsplashResponse.data && unsplashResponse.data.urls) {
          return unsplashResponse.data.urls.regular;
        }
      }
      
      throw new Error('No image found from Unsplash API');
    } catch (unsplashError) {
      console.error('Unsplash API failed:', unsplashError.message);
      // Fall through to final fallback
    }
    
    // Fallback to Unsplash Source (which doesn't require API key but provides less targeted images)
    const fallbackCategories = {
      'stock': 'business',
      'finance': 'business,economy',
      'crypto': 'technology,cryptocurrency',
      'health': 'health,medical'
    };
    
    // Add randomness to make images more diverse
    const randomSeed = Math.floor(Math.random() * 1000);
    const fallbackCategory = fallbackCategories[category] || 'news';
    const width = 1200;
    const height = 628;
    
    // Use Unsplash Source for high-quality free images with random seed
    return `https://source.unsplash.com/featured/${width}x${height}/?${fallbackCategory}&sig=${randomSeed}`;
    
  } catch (error) {
    console.error('Error generating cover image:', error);
    // Last resort fallback - use a generic placeholder
    return `https://placehold.co/1200x628/333/FFF?text=NovaNews:+${category.toUpperCase()}`;
  }
}

// Determine category based on content
function determineCategory(content) {
  const categoryKeywords = {
    stock: ['stock', 'market', 'shares', 'trading', 'nasdaq', 'dow'],
    crypto: ['crypto', 'bitcoin', 'blockchain', 'ethereum', 'token'],
    health: ['health', 'medical', 'wellness', 'disease', 'treatment'],
    finance: ['finance', 'economy', 'banking', 'investment', 'money'],
  };

  const contentLower = content.toLowerCase();
  
  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    if (keywords.some(keyword => contentLower.includes(keyword))) {
      return category;
    }
  }

  return 'custom';
}

// Generate article from URL
app.post('/api/generate-article', async (req, res) => {
  try {
    const { url } = req.body;
    console.log('Generating article from URL:', url);

    // Fetch article content
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);

    // Extract article content
    const title = $('h1').first().text() || $('title').text();
    const articleText = $('article, [role="article"], .article-content, .post-content')
      .text()
      .trim()
      .replace(/\s+/g, ' ');

    console.log('Extracted title:', title);

    // Determine category
    const category = determineCategory(title + articleText);

    // Generate AI content
    const generatedContent = await generateAIContent(title, articleText, category);
    const [aiTitle, aiSummary, ...bodyParts] = generatedContent.split('\n\n');

    // Generate cover image
    const coverImageUrl = await generateCoverImage(aiTitle, category);

    const result = {
      title: aiTitle.replace('Title: ', ''),
      summary: aiSummary.replace('Summary: ', ''),
      body: bodyParts.join('\n\n'),
      cover_image_url: coverImageUrl,
      category,
    };

    console.log('Generated article:', result);
    res.json(result);
  } catch (error) {
    console.error('Error generating article:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper function to validate image URLs
async function isValidImageUrl(url) {
  if (!url) return false;
  
  try {
    // Check if URL is a valid format
    new URL(url);
    
    // Short-circuit for placeholder images - they're always valid
    if (url.includes('placehold.co')) {
      return true;
    }
    
    // Make a HEAD request to check if the image exists and is accessible
    try {
      const response = await axios.head(url, { 
        timeout: 3000, // Shorter timeout to fail faster
        validateStatus: status => status < 400 // Accept any status code less than 400
      });
      
      // Check if the content type is an image
      const contentType = response.headers['content-type'];
      return contentType && contentType.startsWith('image/');
    } catch (requestError) {
      console.log(`Invalid image URL: ${url}`, requestError.message);
      return false;
    }
  } catch (error) {
    console.log(`Malformed URL: ${url}`, error.message);
    return false;
  }
}

// Function to check if two titles are similar
function isTitleSimilar(title1, title2) {
  // If either title is too short, be more strict about similarity
  if (title1.length < 10 || title2.length < 10) {
    return title1 === title2;
  }
  
  // For longer titles, compare using various methods
  
  // Direct contains check
  if (title1.includes(title2) || title2.includes(title1)) {
    return true;
  }
  
  // Check for substantial overlap
  const words1 = title1.split(/\s+/).filter(w => w.length > 3);
  const words2 = title2.split(/\s+/).filter(w => w.length > 3);
  
  // If either has too few significant words, be cautious
  if (words1.length < 3 || words2.length < 3) {
    return false;
  }
  
  // Count matching significant words
  const matchingWords = words1.filter(w => words2.includes(w));
  const matchRatio = matchingWords.length / Math.min(words1.length, words2.length);
  
  // If more than 70% of significant words match, consider it similar
  return matchRatio > 0.7;
}

// Function to save article with strong duplicate detection and fingerprint support
async function saveArticleWithValidation(article) {
  try {
    console.log(`Validating article: ${article.title}`);
    
    // Clean up title and summary from markdown/JSON formatting
    article.title = article.title
      .replace(/#+\s*\*+/g, '')
      .replace(/\*\*/g, '')
      .replace(/:$/g, '')
      .trim();
    
    article.summary = article.summary
      .replace(/^#+\s*\*+Summary\*+/i, '')
      .replace(/\*\*/g, '')
      .replace(/\\n/g, ' ')
      .trim();
    
    // Generate a unique fingerprint for this article - handle case where function might not exist
    const articleFingerprint = typeof generateArticleFingerprint === 'function' 
      ? generateArticleFingerprint(article)
      : `${article.title.substring(0, 50)}-${article.category}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    
    // Ensure article has minimum content requirements
    if (!article.title || !article.summary || !article.body || article.body.length < 500) {
      console.log('Article rejected: Missing required content or insufficient length');
      return { success: false, error: 'Article content requirements not met' };
    }
    
    // Enhanced duplicate detection - check for similar titles and content
    try {
      // Check for exact fingerprint match since we know the column exists
      const { data: fingerprintMatches, error: fingerprintError } = await supabase
        .from('articles')
        .select('id, title, fingerprint')
        .eq('fingerprint', articleFingerprint);
      
      if (!fingerprintError && fingerprintMatches && fingerprintMatches.length > 0) {
        console.log(`Exact fingerprint match found for article: ${article.title}`);
        console.log(`Existing article ID: ${fingerprintMatches[0].id}`);
        return { success: false, error: 'Duplicate article detected (exact fingerprint match)' };
      }
      
      // Next, check for similar titles
      const { data: existingArticles, error: articlesError } = await supabase
        .from('articles')
        .select('id, title, category')
        .order('created_at', { ascending: false })
        .limit(200);
      
      if (!articlesError && existingArticles && existingArticles.length > 0) {
        // Check for title similarity
        for (const existing of existingArticles) {
          // Clean the existing title for comparison
          const cleanExistingTitle = existing.title
            .replace(/#+\s*\*+/g, '')
            .replace(/\*\*/g, '')
            .replace(/:$/g, '')
            .trim()
            .toLowerCase();
          
          const cleanNewTitle = article.title.toLowerCase();
          
          // Calculate similarity with stricter thresholds
          if (isTitleSimilar(cleanExistingTitle, cleanNewTitle)) {
            console.log(`Duplicate article found with title similar to: ${article.title}`);
            console.log(`Existing article ID: ${existing.id}`);
            return { success: false, error: 'Duplicate article detected (title similarity)' };
          }
          
          // Also check for category duplicates with similar topic
          if (existing.category === article.category && hasOverlappingKeywords(cleanExistingTitle, cleanNewTitle)) {
            console.log(`Category duplicate with similar topic found for: ${article.title}`);
            console.log(`Existing article ID: ${existing.id}`);
            return { success: false, error: 'Duplicate article detected (category + topic similarity)' };
          }
        }
      }
    } catch (duplicateError) {
      console.error('Error checking for duplicates:', duplicateError);
      // Continue even if duplicate check fails
    }
    
    // Validate image URL - use our improved image generation API
    try {
      if (!article.cover_image_url || !(await isValidImageUrl(article.cover_image_url))) {
        console.log('Invalid image URL, setting proper image via API');
        
        // Use our image generation API to get a proper image
        try {
          const imageResponse = await axios.get(`http://localhost:${port}/api/generate-image?prompt=${encodeURIComponent(article.title)}&category=${article.category}`);
          if (imageResponse.data && imageResponse.data.imageUrl) {
            article.cover_image_url = imageResponse.data.imageUrl;
          } else {
            throw new Error('Image API returned invalid response');
          }
        } catch (imageApiError) {
          console.log('Image generation API error:', imageApiError.message);
          article.cover_image_url = `https://images.pexels.com/photos/518543/pexels-photo-518543.jpeg?auto=compress&cs=tinysrgb&w=1200&h=628`;
        }
      }
    } catch (imageValidationError) {
      console.log('Image validation error, setting fallback image');
      article.cover_image_url = `https://images.pexels.com/photos/518543/pexels-photo-518543.jpeg?auto=compress&cs=tinysrgb&w=1200&h=628`;
    }
    
    // Insert article with fingerprint (we know the column exists)
    const { data, error } = await supabase
      .from('articles')
      .insert({
        title: article.title,
        summary: article.summary,
        body: article.body,
        cover_image_url: article.cover_image_url,
        category: article.category,
        created_at: article.created_at,
        source_url: article.source_url,
        created_by: 'autogen',
        fingerprint: articleFingerprint,
        status: article.status || 'active' // Use provided status or default to active
      })
      .select();
    
    if (error) {
      console.error('Error saving article:', error);
      return { success: false, error: error.message };
    }
    
    console.log(`Successfully saved article: ${article.title}`);
    return { success: true, data: data[0].id };
  } catch (error) {
    console.error('Error saving article:', error);
    return { success: false, error: error.message };
  }
}

// Helper function to check if titles have significant keyword overlap
function hasOverlappingKeywords(title1, title2) {
  // Extract significant keywords (words longer than 4 chars)
  const keywords1 = title1.split(/\s+/).filter(word => word.length > 4);
  const keywords2 = title2.split(/\s+/).filter(word => word.length > 4);
  
  // Count matching keywords
  const matches = keywords1.filter(word => keywords2.includes(word));
  
  // If at least 3 significant keywords match, consider it overlapping
  return matches.length >= 3;
}

// Generate a consistent fingerprint for article content
function generateArticleFingerprint(article) {
  // Extract key content for fingerprinting
  const titleWords = article.title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const summaryWords = article.summary.toLowerCase().split(/\s+/).filter(w => w.length > 3).slice(0, 10);
  
  // Combine significant words from title and summary
  const significantWords = [...titleWords, ...summaryWords].sort();
  
  // Create a stable fingerprint string
  return significantWords.join('-') + '-' + article.category;
}

// Helper functions to fetch news from different sources
async function fetchFinanceNews() {
  try {
    const response = await axios.get(
      `https://newsapi.org/v2/top-headlines?country=us&category=business&apiKey=${config.newsApiKey}`
    );
    return response.data.articles.slice(0, 5); // Limit to 5 articles
  } catch (error) {
    console.error('Error fetching finance news:', error);
    return [];
  }
}

// Add this before the fetchCryptoNews function
// Global cache for crypto news to avoid rate limits
const cryptoNewsCache = {
  data: null,
  timestamp: null,
  expiresAt: null
};

async function fetchCryptoNews() {
  try {
    // Check for valid cache first (cache for 1 hour during rate limits)
    if (cryptoNewsCache.data && cryptoNewsCache.expiresAt && Date.now() < cryptoNewsCache.expiresAt) {
      console.log(`Using cached crypto news data from ${new Date(cryptoNewsCache.timestamp).toISOString()}`);
      return cryptoNewsCache.data;
    }
    
    // Add some randomness to requests to avoid thundering herd
    await new Promise(resolve => setTimeout(resolve, Math.random() * 1000));
    
    console.log('Fetching crypto news from API...');
    const response = await axios.get(
      `https://cryptopanic.com/api/v1/posts/?auth_token=${config.cryptopanicKey}&kind=news&public=true&limit=10`,
      {
        timeout: 5000,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'NovaNews/1.0 (news aggregator; development)'
        }
      }
    );
    
    if (response.status === 200 && response.data && response.data.results) {
      const news = response.data.results.slice(0, 10);
      
      // Cache the successful response (30 minutes)
      cryptoNewsCache.data = news;
      cryptoNewsCache.timestamp = Date.now();
      cryptoNewsCache.expiresAt = Date.now() + 30 * 60 * 1000; // 30 minutes
      
      return news;
    } else {
      throw new Error('Invalid response format from CryptoPanic API');
    }
  } catch (error) {
    console.error('Error fetching crypto news:', error);
    
    // If rate limited (429), cache the error state longer
    if (error.response && error.response.status === 429) {
      console.log('CryptoPanic API rate limited - using fallback data and extending cache time');
      // Extend cache time to avoid hammering the rate-limited API
      if (cryptoNewsCache.data) {
        cryptoNewsCache.expiresAt = Date.now() + 60 * 60 * 1000; // 1 hour on rate limit
      }
    }
    
    // Return cached data if available, even if expired
    if (cryptoNewsCache.data) {
      console.log('Returning cached crypto news as fallback');
      return cryptoNewsCache.data;
    }
    
    // Fallback hard-coded news data
    console.log('No cache available - using synthetic crypto news data');
    return [
      {
        title: "Bitcoin Price Analysis: BTC Holds Support Above $70,000",
        url: "https://www.example.com/crypto-news/1",
        source: { title: "NovaNews", domain: "novanews.example" },
        published_at: new Date().toISOString(),
        currencies: [{ code: "BTC", title: "Bitcoin", slug: "bitcoin" }]
      },
      {
        title: "Ethereum Completes Major Network Upgrade",
        url: "https://www.example.com/crypto-news/2",
        source: { title: "NovaNews", domain: "novanews.example" },
        published_at: new Date(Date.now() - 3600000).toISOString(),
        currencies: [{ code: "ETH", title: "Ethereum", slug: "ethereum" }]
      },
      {
        title: "Regulatory Clarity Brings Institutional Investors to Crypto Markets",
        url: "https://www.example.com/crypto-news/3",
        source: { title: "NovaNews", domain: "novanews.example" },
        published_at: new Date(Date.now() - 7200000).toISOString(),
        currencies: [{ code: "BTC", title: "Bitcoin", slug: "bitcoin" }, { code: "ETH", title: "Ethereum", slug: "ethereum" }]
      }
    ];
  }
}

async function fetchHealthNews() {
  try {
    const response = await axios.get(
      `https://newsapi.org/v2/top-headlines?country=us&category=health&apiKey=${config.newsApiKey}`
    );
    return response.data.articles.slice(0, 5); // Limit to 5 articles
  } catch (error) {
    console.error('Error fetching health news:', error);
    return [];
  }
}

async function fetchStockNews() {
  try {
    const response = await axios.get(
      `https://newsapi.org/v2/everything?q=stock+market+OR+NASDAQ+OR+NYSE+OR+dow+jones&sortBy=publishedAt&apiKey=${config.newsApiKey}`
    );
    return response.data.articles.slice(0, 5); // Limit to 5 articles
  } catch (error) {
    console.error('Error fetching stock news:', error);
    return [];
  }
}

// Helper functions to extract title and summary from AI content
function extractTitleFromContent(content) {
  // Try to find a title in the content
  const titleMatch = content.match(/Title:\s*(.+?)(?:\n|$)/);
  if (titleMatch && titleMatch[1]) {
    return titleMatch[1].trim();
  }
  
  // If no explicit title, take the first line as title
  const lines = content.split('\n');
  for (const line of lines) {
    const cleaned = line.trim();
    if (cleaned && cleaned.length > 10 && cleaned.length < 200) {
      return cleaned;
    }
  }
  
  // Fallback
  return 'Fentrix.AI News Update';
}

function extractSummaryFromContent(content) {
  // Try to find a summary in the content
  const summaryMatch = content.match(/Summary:\s*(.+?)(?:\n\n|$)/s);
  if (summaryMatch && summaryMatch[1]) {
    return summaryMatch[1].trim();
  }
  
  // If no explicit summary, take the first paragraph after the title
  const paragraphs = content.split('\n\n');
  if (paragraphs.length > 1) {
    return paragraphs[1].trim();
  }
  
  // Fallback
  return 'Latest news update from Fentrix.AI.';
}

// Global variables for tracking update times
let nextScheduledUpdateTime = null;
let currentTimeFrame = null;
let isProcessingNews = false;
let lastUpdateTime = null;

// Global cache for stock data to prevent excessive API calls
let stockCache = {
  lastUpdated: null,
  data: null,
  expiresAt: null
};

// Helper function to update the current timeframe based on UTC time
function updateCurrentTimeFrame(date) {
  const hours = date.getUTCHours();
  let timeframe = "";
  
  if (hours >= 0 && hours < 4) {
    timeframe = "12am-4am";
  } else if (hours >= 4 && hours < 8) {
    timeframe = "4am-8am";
  } else if (hours >= 8 && hours < 12) {
    timeframe = "8am-12pm";
  } else if (hours >= 12 && hours < 16) {
    timeframe = "12pm-4pm";
  } else if (hours >= 16 && hours < 20) {
    timeframe = "4pm-8pm";
  } else {
    timeframe = "8pm-12am";
  }
  
  currentTimeFrame = timeframe;
  return timeframe;
}

function calculateNextUpdateTime() {
  const now = new Date();
  
  // Fixed 4-hour intervals starting at midnight UTC (12am, 4am, 8am, 12pm, 4pm, 8pm)
  const hours = now.getUTCHours();
  const nextIntervalHour = Math.ceil(hours / 4) * 4 % 24;
  const nextUpdateTime = new Date(now);
  nextUpdateTime.setUTCMinutes(0, 0, 0); // Reset minutes, seconds, milliseconds
  nextUpdateTime.setUTCHours(nextIntervalHour);
  
  // If that time is in the past or too close to now, schedule for the next 4-hour interval
  if (nextUpdateTime <= now || (nextUpdateTime.getTime() - now.getTime()) < 10 * 60 * 1000) {
    nextUpdateTime.setUTCHours(nextUpdateTime.getUTCHours() + 4);
  }
  
  // Determine current timeframe
  const timeframe = updateCurrentTimeFrame(now);
  
  console.log(`Current time (UTC): ${now.toUTCString()}`);
  console.log(`Current timeframe: ${timeframe}`);
  console.log(`Calculated next update time (UTC): ${nextUpdateTime.toUTCString()}`);
  
  return nextUpdateTime;
}

// Function to check if an article with similar title already exists
async function isDuplicateArticle(title, category) {
  try {
    // First check by fingerprint
    const fingerprint = `${title.toLowerCase().substring(0, 50)}-${category}`.replace(/[^a-z0-9-]/g, '-');
    
    // Check for exact fingerprint match
    const { data: fingerprintMatches, error: fingerprintError } = await supabase
      .from('articles')
      .select('id, title')
      .eq('fingerprint', fingerprint);
    
    if (!fingerprintError && fingerprintMatches && fingerprintMatches.length > 0) {
      console.log(`Duplicate detected by fingerprint: "${title}" matches "${fingerprintMatches[0].title}"`);
      return true;
    }
    
    // Next, check for similar titles
    const { data: existingArticles, error: articlesError } = await supabase
      .from('articles')
      .select('id, title, category')
      .order('created_at', { ascending: false })
      .limit(50); // Check recent articles
    
    if (!articlesError && existingArticles && existingArticles.length > 0) {
      for (const existing of existingArticles) {
        const cleanExistingTitle = existing.title.toLowerCase();
        const cleanNewTitle = title.toLowerCase();
        
        // Check for direct substring matches
        if (cleanExistingTitle.includes(cleanNewTitle) || 
            cleanNewTitle.includes(cleanExistingTitle)) {
          console.log(`Duplicate detected by substring: "${title}" similar to "${existing.title}"`);
          return true;
        }
        
        // Check for word overlap
        const wordsA = cleanExistingTitle.split(/\s+/).filter(w => w.length > 3);
        const wordsB = cleanNewTitle.split(/\s+/).filter(w => w.length > 3);
        const matchingWords = wordsA.filter(w => wordsB.includes(w));
        
        // If more than 60% of words match, consider it a duplicate
        if (matchingWords.length > 0 && 
            (matchingWords.length / Math.min(wordsA.length, wordsB.length)) > 0.6) {
          console.log(`Duplicate detected by word overlap: "${title}" similar to "${existing.title}"`);
          return true;
        }
      }
    }
    
    return false; // No duplicate found
  } catch (error) {
    console.error('Error checking for duplicate article:', error);
    return false; // On error, allow the article to be created
  }
}

// Function to process news in batches with proper validation
async function processNews(force = false) {
  // Only allow one process at a time unless force is true
  if (isProcessingNews && !force) {
    console.log("News processing already in progress. Skipping this run.");
    return { success: false, error: "Already processing" };
  }
  
  try {
    isProcessingNews = true;
    console.log("Starting news processing...");
    const startTime = new Date();
    
    // 1. First manage the article lifecycle (archive/delete old articles)
    await manageArticleLifecycle();
    
    // 2. Process stock data and news updates
    const stocksData = await getLatestStockData();
    if (!stocksData || !stocksData.length) {
      throw new Error("Failed to retrieve stock data");
    }
    
    // Cache the stock data for future use
    cachedStockData = stocksData;
    
    // Process articles in a batch for each category
    const categories = ['Technology', 'Finance', 'Healthcare', 'Energy', 'Consumer Goods'];
    let totalArticlesCreated = 0;
    
    // Process categories one by one (can be made parallel if needed)
    for (const category of categories) {
      console.log(`Processing news for category: ${category}`);
      
      // Generate 2-3 articles per category
      const articlesPerCategory = Math.floor(Math.random() * 2) + 2; // 2-3 articles
      
      for (let i = 0; i < articlesPerCategory; i++) {
        // Select a few relevant stocks for this category
        const relevantStocks = stocksData
          .filter(stock => stock.sector === category || Math.random() < 0.2)
          .slice(0, 3);
          
        if (!relevantStocks.length) continue;
        
        // Generate news content using the selected stocks
        try {
          const newsData = await generateNewsContent(relevantStocks, category);
          
          // Skip if no content was generated
          if (!newsData || !newsData.title || !newsData.content) {
            console.log(`Failed to generate article ${i+1} for ${category}`);
            continue;
          }
          
          // Check for duplicates before insertion
          const isDuplicate = await isDuplicateArticle(newsData.title, category);
          if (isDuplicate) {
            console.log(`Skipping duplicate article: ${newsData.title}`);
            continue;
          }
          
          // Insert the article into the database
          const { data, error } = await supabase
            .from('articles')
            .insert({
              title: newsData.title,
              content: newsData.content,
              category: category,
              stocks_mentioned: relevantStocks.map(s => s.symbol),
              status: 'active',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            });
            
          if (error) {
            console.error(`Error inserting article for ${category}:`, error);
          } else {
            console.log(`Successfully created article: ${newsData.title}`);
            totalArticlesCreated++;
          }
        } catch (error) {
          console.error(`Error generating news for ${category}:`, error);
        }
      }
    }
    
    // Update the last update time
    lastUpdateTime = new Date();
    console.log(`News processing completed. Created ${totalArticlesCreated} articles.`);
    
    // Calculate the next update time
    nextScheduledUpdateTime = calculateNextUpdateTime();
    console.log(`Next news update scheduled for: ${nextScheduledUpdateTime.toUTCString()}`);
    
    return { 
      success: true, 
      articlesCreated: totalArticlesCreated,
      processingTime: (new Date() - startTime) / 1000,
      nextUpdate: nextScheduledUpdateTime.toISOString()
    };
  } catch (error) {
    console.error("Error in news processing:", error);
    return { success: false, error: error.message };
  } finally {
    isProcessingNews = false;
  }
}

// Start the server
const PORT = process.env.PORT || 3005;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  
  // Run the environment variable check
  const envCheck = checkEnvironmentVariables();
  if (!envCheck) {
    console.warn("WARNING: Some environment variables are missing. The server may not function correctly.");
  }
  
  // Log Alpha Vantage API key status
  console.log(`Alpha Vantage API key available: ${config.alphaVantageKey ? 'Yes' : 'No'}`);
  console.log(`Environment loaded from: ${path.resolve(__dirname, '../.env')}`);
  
  // Initialize timer system
  nextScheduledUpdateTime = calculateNextUpdateTime();
  console.log(`Server started. Next update scheduled for: ${nextScheduledUpdateTime.toUTCString()}`);
  
  // Run an initial update when the server starts
  console.log('Starting initial news fetch process...');
  processNews(true).catch(err => {
    console.error('Error during initial news fetch:', err);
  });
  
  // Start article lifecycle management
  console.log('Starting article lifecycle management...');
  startArticleLifecycleManagement();
});

// Article lifecycle management - handles moving articles from active to archive to deletion
async function startArticleLifecycleManagement() {
  // Run immediately on startup
  try {
    await manageArticleLifecycle();
  } catch (error) {
    console.error('Error in initial article lifecycle management:', error);
  }
  
  // Then run every 10 minutes
  setInterval(async () => {
    try {
      await manageArticleLifecycle();
    } catch (error) {
      console.error('Error in article lifecycle management:', error);
    }
  }, 10 * 60 * 1000); // Every 10 minutes
}

// Function to manage article lifecycle based only on timestamps
async function manageArticleLifecycle() {
  console.log('Running article lifecycle management...');
  const now = new Date();
  
  try {
    // Try to create the lifecycle_log table if it doesn't exist
    try {
      // Check if the table exists first - use a safer approach
      let tableExists = false;
      try {
        const { data, error } = await supabase
          .from('lifecycle_log')
          .select('id')
          .limit(1);
        
        tableExists = !error && data !== null;
      } catch (checkError) {
        console.log('Error checking if lifecycle_log table exists:', checkError.message);
        tableExists = false;
      }
      
      if (!tableExists) {
        // Since we can't use execute_sql function, we'll modify our approach
        // Instead, we'll just handle the errors when trying to insert into the table
        // and create a separate migration script if needed
        console.log('lifecycle_log table likely does not exist. Will handle errors when inserting.');
        
        // We'll use regular inserts for logging, and they'll fail gracefully if the table doesn't exist
        // No need to try creating the table here - it would need admin privileges
      } else {
        console.log('lifecycle_log table already exists');
      }
    } catch (tableError) {
      console.log('Lifecycle log table creation skipped due to error:', tableError.message);
    }
    
    // 1. Move articles older than current timeframe (4h) to archive status
    const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000);
    const { data: articlesToArchive, error: archiveError } = await supabase
      .from('articles')
      .update({ status: 'archived' })
      .eq('status', 'active')
      .lt('created_at', fourHoursAgo.toISOString())
      .select();
    
    if (archiveError) {
      throw new Error(`Error archiving articles: ${archiveError.message}`);
    }
    
    const archivedCount = articlesToArchive ? articlesToArchive.length : 0;
    if (archivedCount > 0) {
      console.log(`Archived ${archivedCount} articles that are over 4 hours old`);
      
      // Log each archived article, but handle table not existing gracefully
      for (const article of articlesToArchive) {
        try {
          const { error } = await supabase
            .from('lifecycle_log')
            .insert({
              action: 'archived',
              article_id: article.id,
              article_title: article.title,
              details: {
                created_at: article.created_at,
                archived_at: now.toISOString(),
                age_hours: ((now.getTime() - new Date(article.created_at).getTime()) / (1000 * 60 * 60)).toFixed(2)
              }
            });
            
          if (error) {
            // The table might not exist, but we can continue without it
            console.log('Could not log archived article - lifecycle_log may not exist:', error.message);
          }
        } catch (logError) {
          console.error('Error logging archive event:', logError.message);
          // Continue processing even if logging fails
        }
      }
    }
    
    // 2. Delete articles that have been in archive for more than 4 hours (8h total)
    const eightHoursAgo = new Date(now.getTime() - 8 * 60 * 60 * 1000);
    const { data: deletedArticles, error: deleteError } = await supabase
      .from('articles')
      .delete()
      .eq('status', 'archived')
      .lt('created_at', eightHoursAgo.toISOString())
      .select();
    
    if (deleteError) {
      throw new Error(`Error deleting old archived articles: ${deleteError.message}`);
    }
    
    const deletedCount = deletedArticles ? deletedArticles.length : 0;
    if (deletedCount > 0) {
      console.log(`Deleted ${deletedCount} archived articles that are over 8 hours old`);
      
      // Log each deleted article, but handle table not existing gracefully
      for (const article of deletedArticles) {
        try {
          const { error } = await supabase
            .from('lifecycle_log')
            .insert({
              action: 'deleted',
              article_id: article.id,
              article_title: article.title,
              details: {
                created_at: article.created_at,
                deleted_at: now.toISOString(),
                age_hours: ((now.getTime() - new Date(article.created_at).getTime()) / (1000 * 60 * 60)).toFixed(2)
              }
            });
            
          if (error) {
            // The table might not exist, but we can continue without it
            console.log('Could not log deleted article - lifecycle_log may not exist:', error.message);
          }
        } catch (logError) {
          console.error('Error logging delete event:', logError.message);
          // Continue processing even if logging fails
        }
      }
    }
    
    // Log summary
    console.log(`Article lifecycle management complete: ${archivedCount} archived, ${deletedCount} deleted`);
    
    return { archived: archivedCount, deleted: deletedCount };
  } catch (error) {
    console.error('Error in article lifecycle management:', error);
    return { error: error.message };
  }
}

// Schedule timer to check every minute if we need to run the news process
setInterval(async () => {
  const now = new Date();
  
  // Update current timeframe
  updateCurrentTimeFrame(now);
  
  // Check if we need to run the news process
  if (nextScheduledUpdateTime && now >= nextScheduledUpdateTime && !isProcessingNews) {
    console.log(`Timer triggered: Running scheduled news update at ${now.toUTCString()}`);
    
    try {
      // Process the news
      await processNews();
      
      // Calculate the next update time (should already be set in processNews, but just in case)
      nextScheduledUpdateTime = calculateNextUpdateTime();
      console.log(`Next update scheduled for: ${nextScheduledUpdateTime.toUTCString()}`);
    } catch (error) {
      console.error("Error in scheduled news update:", error);
      
      // If an error occurred, set the next update to 15 minutes from now
      nextScheduledUpdateTime = new Date(now.getTime() + 15 * 60 * 1000);
      console.log(`Error occurred. Rescheduled update for: ${nextScheduledUpdateTime.toUTCString()}`);
    }
  }
}, 60 * 1000); // Check every 60 seconds

// Function to process an individual article
async function processArticle(title, articleData, category) {
  try {
    console.log(`Processing ${category} article: ${title}`);
    
    // Extract content from article data based on source
    let content = '';
    if (articleData.content) {
      content = articleData.content;
    } else if (articleData.description) {
      content = articleData.description;
    } else if (articleData.title) {
      content = articleData.title;
    }
    
    if (content.length < 50) {
      console.log(`Warning: Very short content (${content.length} chars) for article: ${title}`);
    }
    
    if (category === 'crypto' && articleData.currencies) {
      // For crypto articles from CryptoPanic, extract currency info
      const currencies = articleData.currencies.map(c => c.title).join(', ');
      content = `${content} Related to: ${currencies}`;
    }
    
    // Generate AI content using the title and extracted content
    let aiContent;
    try {
      console.log(`Generating AI content for article: ${title}`);
      aiContent = await generateAIContent(title, content, category);
      console.log(`AI content generated successfully: ${aiContent.length} chars`);
    } catch (error) {
      console.error('Error generating AI content:', error);
      // If AI content generation fails, create a simpler article
      console.log('Using fallback content template');
      aiContent = `# **${title}**\n\nSummary: Recent developments in ${category}.\n\n${content}`;
    }
    
    // Extract title and summary from AI content
    const aiTitle = extractTitleFromContent(aiContent);
    const aiSummary = extractSummaryFromContent(aiContent);
    
    console.log(`Extracted title: "${aiTitle}"`);
    console.log(`Extracted summary: "${aiSummary.substring(0, 100)}..."`);
    
    // Generate cover image
    let coverImageUrl;
    try {
      console.log(`Generating image for: ${aiTitle}`);
      coverImageUrl = await generateCoverImage(aiTitle, category);
      console.log(`Image generated: ${coverImageUrl}`);
    } catch (imageError) {
      console.error('Error generating cover image:', imageError);
      coverImageUrl = `https://placehold.co/1200x628/333/FFF?text=NovaNews:+${category.toUpperCase()}`;
      console.log(`Using fallback image: ${coverImageUrl}`);
    }
    
    // Create the article object
    const article = {
      title: aiTitle,
      summary: aiSummary,
      body: aiContent,
          cover_image_url: coverImageUrl,
          category,
      created_at: new Date().toISOString(),
      source_url: articleData.url || null,
      created_by: 'autogen',
      status: 'active' // Always create new articles with active status
    };
    
    // Save article to database
    console.log(`Saving article to database: ${aiTitle}`);
    const result = await saveArticleWithValidation(article);
    
    if (result.success) {
      console.log(`Article processed and saved successfully: ${aiTitle}`);
      return { success: true, articleId: result.data };
    } else {
      console.log(`Failed to save article: ${result.error}`);
      return { success: false, error: result.error };
    }
  } catch (error) {
    console.error('Error processing article:', error);
    return { success: false, error: error.message };
  }
}

// Update image generation endpoint to use direct reliable image URLs
app.get('/api/generate-image', async (req, res) => {
  try {
    console.log('Image generation request received');
    const { prompt, category } = req.query;
    
    if (!prompt) {
      return res.status(400).json({ 
        error: 'Missing prompt parameter',
        message: 'A prompt is required to generate an image'
      });
    }
    
    // Extract keywords from prompt
    const keywords = extractKeywords(prompt, category);
    console.log(`Image keywords: ${keywords}`);
    
    // Try Pixabay API first (free with attribution)
    try {
      // Pixabay API (free)
      const pixabayKey = '44299196-3edcb3a7a0a9d13bdaa3c8267'; // Public test key with attribution
      const pixabayUrl = `https://pixabay.com/api/?key=${pixabayKey}&q=${encodeURIComponent(keywords)}&image_type=photo&orientation=horizontal&min_width=800&per_page=3`;
      
      console.log('Fetching image from Pixabay');
      const pixabayResponse = await axios.get(pixabayUrl, { timeout: 5000 });
      
      if (pixabayResponse.data && pixabayResponse.data.hits && pixabayResponse.data.hits.length > 0) {
        // Select a random image from results
        const randomIndex = Math.floor(Math.random() * Math.min(3, pixabayResponse.data.hits.length));
        const selectedImage = pixabayResponse.data.hits[randomIndex];
        
        console.log(`Found Pixabay image: ${selectedImage.webformatURL}`);
        
        return res.json({ 
          imageUrl: selectedImage.webformatURL,
          source: 'pixabay',
          attribution: `Image by ${selectedImage.user} on Pixabay`,
          tags: selectedImage.tags
        });
      }
    } catch (pixabayError) {
      console.error('Pixabay API error:', pixabayError.message);
    }
    
    // Fallback to category-specific Pexels images
    const categoryImages = {
      'finance': [
        'https://images.pexels.com/photos/534216/pexels-photo-534216.jpeg?auto=compress&cs=tinysrgb&w=1200&h=628',
        'https://images.pexels.com/photos/4386158/pexels-photo-4386158.jpeg?auto=compress&cs=tinysrgb&w=1200&h=628',
        'https://images.pexels.com/photos/210607/pexels-photo-210607.jpeg?auto=compress&cs=tinysrgb&w=1200&h=628',
        'https://images.pexels.com/photos/730547/pexels-photo-730547.jpeg?auto=compress&cs=tinysrgb&w=1200&h=628',
        'https://images.pexels.com/photos/6801648/pexels-photo-6801648.jpeg?auto=compress&cs=tinysrgb&w=1200&h=628'
      ],
      'crypto': [
        'https://images.pexels.com/photos/6780789/pexels-photo-6780789.jpeg?auto=compress&cs=tinysrgb&w=1200&h=628',
        'https://images.pexels.com/photos/8370752/pexels-photo-8370752.jpeg?auto=compress&cs=tinysrgb&w=1200&h=628',
        'https://images.pexels.com/photos/8919570/pexels-photo-8919570.jpeg?auto=compress&cs=tinysrgb&w=1200&h=628',
        'https://images.pexels.com/photos/844124/pexels-photo-844124.jpeg?auto=compress&cs=tinysrgb&w=1200&h=628',
        'https://images.pexels.com/photos/7788009/pexels-photo-7788009.jpeg?auto=compress&cs=tinysrgb&w=1200&h=628'
      ],
      'health': [
        'https://images.pexels.com/photos/4386467/pexels-photo-4386467.jpeg?auto=compress&cs=tinysrgb&w=1200&h=628',
        'https://images.pexels.com/photos/4047186/pexels-photo-4047186.jpeg?auto=compress&cs=tinysrgb&w=1200&h=628',
        'https://images.pexels.com/photos/5473182/pexels-photo-5473182.jpeg?auto=compress&cs=tinysrgb&w=1200&h=628',
        'https://images.pexels.com/photos/3683074/pexels-photo-3683074.jpeg?auto=compress&cs=tinysrgb&w=1200&h=628',
        'https://images.pexels.com/photos/4386466/pexels-photo-4386466.jpeg?auto=compress&cs=tinysrgb&w=1200&h=628'
      ],
      'stock': [
        'https://images.pexels.com/photos/159888/pexels-photo-159888.jpeg?auto=compress&cs=tinysrgb&w=1200&h=628',
        'https://images.pexels.com/photos/6801648/pexels-photo-6801648.jpeg?auto=compress&cs=tinysrgb&w=1200&h=628',
        'https://images.pexels.com/photos/8370764/pexels-photo-8370764.jpeg?auto=compress&cs=tinysrgb&w=1200&h=628',
        'https://images.pexels.com/photos/7567486/pexels-photo-7567486.jpeg?auto=compress&cs=tinysrgb&w=1200&h=628',
        'https://images.pexels.com/photos/186461/pexels-photo-186461.jpeg?auto=compress&cs=tinysrgb&w=1200&h=628'
      ],
      'news': [
        'https://images.pexels.com/photos/518543/pexels-photo-518543.jpeg?auto=compress&cs=tinysrgb&w=1200&h=628',
        'https://images.pexels.com/photos/5428836/pexels-photo-5428836.jpeg?auto=compress&cs=tinysrgb&w=1200&h=628',
        'https://images.pexels.com/photos/1369476/pexels-photo-1369476.jpeg?auto=compress&cs=tinysrgb&w=1200&h=628',
        'https://images.pexels.com/photos/3944454/pexels-photo-3944454.jpeg?auto=compress&cs=tinysrgb&w=1200&h=628',
        'https://images.pexels.com/photos/3957987/pexels-photo-3957987.jpeg?auto=compress&cs=tinysrgb&w=1200&h=628'
      ],
      'technology': [
        'https://images.pexels.com/photos/6963944/pexels-photo-6963944.jpeg?auto=compress&cs=tinysrgb&w=1200&h=628',
        'https://images.pexels.com/photos/1261427/pexels-photo-1261427.jpeg?auto=compress&cs=tinysrgb&w=1200&h=628',
        'https://images.pexels.com/photos/4348401/pexels-photo-4348401.jpeg?auto=compress&cs=tinysrgb&w=1200&h=628',
        'https://images.pexels.com/photos/2582937/pexels-photo-2582937.jpeg?auto=compress&cs=tinysrgb&w=1200&h=628',
        'https://images.pexels.com/photos/2582935/pexels-photo-2582935.jpeg?auto=compress&cs=tinysrgb&w=1200&h=628'
      ]
    };
    
    // Determine which category to use
    const usedCategory = category && categoryImages[category] ? category : 'news';
    
    // Select a random image from the category
    const images = categoryImages[usedCategory];
    const randomIndex = Math.floor(Math.random() * images.length);
    const imageUrl = images[randomIndex];
    
    console.log(`Using fallback image: ${imageUrl}`);
    
    // Return the image URL
    res.json({
      imageUrl: imageUrl,
      source: 'pexels',
      category: usedCategory,
      fallback: true
    });
  } catch (error) {
    console.error('Error in image generation endpoint:', error);
    res.status(500).json({ 
      error: error.message,
      fallbackImage: 'https://images.pexels.com/photos/518543/pexels-photo-518543.jpeg?auto=compress&cs=tinysrgb&w=1200&h=628'
    });
  }
});

// Function to extract meaningful keywords from a prompt for better image generation
function extractKeywords(prompt, category) {
  // Remove markdown formatting and special characters
  let cleanPrompt = prompt
    .replace(/#+\s*\**/g, '')
    .replace(/\*\*/g, '')
    .replace(/\[|\]/g, '')
    .replace(/\(|\)/g, '')
    .replace(/–/g, '-')
    .replace(/"/g, '')
    .replace(/'/g, '')
    .replace(/:/g, '')
    .replace(/\?/g, '')
    .replace(/\!/g, '')
    .trim();
    
  // Split into words and filter out common words, articles, conjunctions
  const stopWords = ['the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 
                     'in', 'on', 'at', 'to', 'for', 'with', 'by', 'about', 'like', 
                     'through', 'over', 'before', 'after', 'since', 'of', 'from'];
                     
  const words = cleanPrompt.split(' ')
    .filter(word => word.length > 2) // Filter out short words
    .filter(word => !stopWords.includes(word.toLowerCase())); // Filter out stop words
  
  // Get most meaningful words (usually nouns and adjectives are key for images)
  // For simplicity, we'll use the first 4-5 words after filtering
  let mainKeywords = words.slice(0, Math.min(5, words.length));
  
  // Add category-specific keywords for better results
  const categoryKeywords = {
    'finance': ['business', 'finance', 'money', 'economy', 'chart', 'growth'],
    'crypto': ['cryptocurrency', 'blockchain', 'digital', 'technology', 'bitcoin', 'crypto'],
    'health': ['healthcare', 'medical', 'wellness', 'healthy', 'medicine', 'doctor'],
    'stock': ['stock', 'market', 'trading', 'finance', 'business', 'chart'],
    'news': ['news', 'journalism', 'media', 'report', 'current'],
    'technology': ['tech', 'digital', 'computer', 'innovation', 'futuristic']
  };
  
  // Add 2-3 random category-specific keywords for diversity
  if (category && categoryKeywords[category]) {
    const catKeywords = categoryKeywords[category];
    // Shuffle array and take first 2-3 items
    const shuffled = [...catKeywords].sort(() => 0.5 - Math.random());
    const selectedCatKeywords = shuffled.slice(0, Math.min(3, shuffled.length));
    
    // Add to main keywords
    mainKeywords = [...mainKeywords, ...selectedCatKeywords];
  }
  
  // Avoid sensitive terms for safer image search
  const safeKeywords = mainKeywords.map(keyword => 
    keyword.toLowerCase()
      .replace(/trump/gi, 'politician')
      .replace(/biden/gi, 'president')
      .replace(/sex/gi, 'health')
      .replace(/nsfw/gi, 'content')
      .replace(/weapon/gi, 'tool')
      .replace(/gun/gi, 'policy')
  );
  
  // Add a few descriptive adjectives for better images
  const descriptiveAdjectives = [
    'professional', 'modern', 'high quality', 'detailed', 'realistic', 
    'clear', 'vibrant', 'dynamic', 'elegant'
  ];
  
  // Add 1-2 random descriptive adjectives for better image quality
  const shuffledAdjectives = [...descriptiveAdjectives].sort(() => 0.5 - Math.random());
  const selectedAdjectives = shuffledAdjectives.slice(0, 2);
  
  // Add "news article" or "illustration" for context
  const contextTerms = ['news article', 'illustration', 'photograph'];
  const randomContext = contextTerms[Math.floor(Math.random() * contextTerms.length)];
  
  // Combine everything, remove duplicates, and return as array
  const finalKeywords = [...new Set([
    ...safeKeywords, 
    ...selectedAdjectives, 
    randomContext
  ])];
  
  return finalKeywords;
}

// Replace the mock stock data endpoint with a real-time financial API
app.get('/api/stocks', async (req, res) => {
  try {
    // Set explicit CORS headers for this endpoint to ensure it works from all origins
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.header('Pragma', 'no-cache');
    res.header('Expires', '0');
    
    console.log('Stock API request received');
    
    // Check if this is an OPTIONS preflight request
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    // Define popular stocks to track (smaller set to avoid rate limiting)
    const stocks = ['AAPL', 'MSFT', 'GOOGL', 'TSLA', 'NVDA', 'META', 'AMZN', 'JPM', 'V', 'DIS', 'NFLX', 'AMD', 'BA', 'KO', 'PEP', 'WMT', 'PYPL', 'CRM', 'IBM'];
    
    // Define crypto symbols (smaller set to avoid rate limiting)
    const cryptoSymbols = ['BTCUSD', 'ETHUSD', 'XRPUSD', 'SOLUSD', 'DOGEUSD', 'ADAUSD', 'DOTUSD', 'LTCUSD', 'LINKUSD', 'AVAXUSD'];
    
    const allSymbols = [...stocks, ...cryptoSymbols];
    
    // Company names mapping for better display
    const companyMapping = {
      'AAPL': 'Apple Inc.',
      'MSFT': 'Microsoft Corp.',
      'GOOGL': 'Alphabet Inc.',
      'AMZN': 'Amazon.com Inc.',
      'TSLA': 'Tesla Inc.',
      'META': 'Meta Platforms Inc.',
      'NVDA': 'NVIDIA Corp.',
      'JPM': 'JPMorgan Chase & Co.',
      'V': 'Visa Inc.',
      'DIS': 'The Walt Disney Company',
      'NFLX': 'Netflix Inc.',
      'AMD': 'Advanced Micro Devices, Inc.',
      'BA': 'Boeing Co.',
      'KO': 'Coca-Cola Co.',
      'PEP': 'PepsiCo Inc.',
      'WMT': 'Walmart Inc.',
      'PYPL': 'PayPal Holdings Inc.',
      'CRM': 'Salesforce Inc.',
      'IBM': 'IBM Corp.',
      'BTCUSD': 'Bitcoin',
      'ETHUSD': 'Ethereum',
      'XRPUSD': 'Ripple',
      'SOLUSD': 'Solana',
      'DOGEUSD': 'Dogecoin',
      'ADAUSD': 'Cardano',
      'DOTUSD': 'Polkadot',
      'LTCUSD': 'Litecoin',
      'LINKUSD': 'Chainlink',
      'AVAXUSD': 'Avalanche'
    };
    
    // Create an API status tracker for this request
    const apiStatus = {
      attempted: 0,
      success: 0,
      failed: 0,
      errors: [],
      fromCache: {}
    };
    
    // Use Finnhub API exclusively
    const finnhubKey = 'cvgs4rhr01qi76d4v2u0cvgs4rhr01qi76d4v2ug'; // Original correct key
    // No backup key needed, using the original correct key
    
    // User-Agent to reduce likelihood of being blocked
    const apiUserAgent = 'NovaNews/1.0 (news aggregation app; production)';
    
    // ======= CACHING STRATEGY ========
    // Check if we have a valid global cache to minimize API calls
    const now = Date.now();
    let stocksData = [];
    let shouldRefreshCache = true;
    let cacheAge = 0;
    
    // Check if we have valid cached data
    if (stockCache.data && stockCache.expiresAt) {
      cacheAge = Math.floor((now - stockCache.lastUpdated) / 1000);
      
      if (now < stockCache.expiresAt) {
        console.log(`Using cached stock data from ${new Date(stockCache.lastUpdated).toISOString()}, expires in ${Math.floor((stockCache.expiresAt - now)/1000)}s`);
        shouldRefreshCache = false;
        stocksData = stockCache.data.stocks;
        
        apiStatus.fromCache = {
          age: cacheAge,
          lastUpdated: new Date(stockCache.lastUpdated).toISOString(),
          expires: new Date(stockCache.expiresAt).toISOString()
        };
      }
    }
    
    // If we need to refresh the cache, fetch new data from Finnhub
    if (shouldRefreshCache) {
      console.log('Cache expired or not available - fetching fresh data from Finnhub');
      
      // Use current second to rotate through symbols (for maximum data coverage over time)
      const currentSecond = new Date().getSeconds();
      
      // Determine which symbols to fetch in this request (rotating)
      // Only fetch 3 symbols per request - 2 stocks and 1 crypto max
      const maxStocksPerRequest = 2;
      const maxCryptoPerRequest = 1;
      
      // Select stocks based on rotation
      const stockStartIndex = (currentSecond % (stocks.length / maxStocksPerRequest)) * maxStocksPerRequest;
      const selectedStocks = stocks.slice(stockStartIndex, stockStartIndex + maxStocksPerRequest);
      
      // Select crypto based on rotation (just alternate between BTC and ETH)
      const selectedCrypto = currentSecond % 2 === 0 ? ['BTCUSD'] : [];
      
      // Combine selected symbols
      const symbolsToFetch = [...selectedStocks, ...selectedCrypto];
      
      console.log(`Fetching data for rotation ${Math.floor(currentSecond / 10)}: ${symbolsToFetch.join(', ')}`);
      
      // If we have existing cache, use it as base and update only the selected symbols
      if (stockCache.data && stockCache.data.stocks) {
        stocksData = [...stockCache.data.stocks];
      }
      
      // Process symbols one at a time with delay between calls
      for (let i = 0; i < symbolsToFetch.length; i++) {
        const symbol = symbolsToFetch[i];
        try {
          apiStatus.attempted++;
          console.log(`Fetching data for ${symbol}`);
          
          // Handle crypto vs stocks differently
          if (symbol.includes('USD')) {
            // For crypto, use the quote endpoint instead of candles to avoid 403
            const url = `https://finnhub.io/api/v1/quote?symbol=BINANCE:${symbol.substring(0, 3)}USDT&token=${finnhubKey}`;
            
            const response = await axios.get(url, { 
              timeout: 5000,
              headers: {
                'User-Agent': apiUserAgent,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
              }
            });
            
            if (response.data && response.data.c) {
              const currentPrice = response.data.c;
              const prevClose = response.data.pc;
              const change = currentPrice - prevClose;
              const changePercent = (change / prevClose) * 100;
              
              const stockData = {
                symbol,
                price: currentPrice.toFixed(2),
                change: change.toFixed(2),
                changePercent: changePercent.toFixed(2),
                high: response.data.h.toFixed(2),
                low: response.data.l.toFixed(2),
                company: companyMapping[symbol] || symbol,
                lastUpdated: new Date().toISOString(),
                timestamp: new Date(response.data.t * 1000).toISOString(),
                source: 'finnhub-real-time'
              };
              
              // Replace in existing array or add
              const existingIndex = stocksData.findIndex(s => s.symbol === symbol);
              if (existingIndex >= 0) {
                stocksData[existingIndex] = stockData;
              } else {
                stocksData.push(stockData);
              }
              
              apiStatus.success++;
            } else {
              throw new Error('Invalid response format for crypto');
            }
          } else {
            // For stocks, use the quote endpoint
            const url = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${finnhubKey}`;
            
            const response = await axios.get(url, { 
              timeout: 5000,
              headers: {
                'User-Agent': apiUserAgent,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
              }
            });
            
            if (response.data && response.data.c) {
              const stockData = {
                symbol,
                price: response.data.c.toFixed(2),
                change: response.data.d.toFixed(2),
                changePercent: response.data.dp.toFixed(2),
                high: response.data.h.toFixed(2),
                low: response.data.l.toFixed(2),
                open: response.data.o.toFixed(2),
                prevClose: response.data.pc.toFixed(2),
                company: companyMapping[symbol] || symbol,
                lastUpdated: new Date().toISOString(),
                timestamp: new Date(response.data.t * 1000).toISOString(),
                source: 'finnhub-real-time'
              };
              
              // Replace in existing array or add
              const existingIndex = stocksData.findIndex(s => s.symbol === symbol);
              if (existingIndex >= 0) {
                stocksData[existingIndex] = stockData;
              } else {
                stocksData.push(stockData);
              }
              
              apiStatus.success++;
            } else {
              throw new Error('Invalid response format for stock');
            }
          }
          
          // Add a delay between API calls (300ms) to prevent rate limiting
          if (i < symbolsToFetch.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 300));
          }
  } catch (error) {
          apiStatus.failed++;
          console.error(`Error fetching ${symbol}:`, error.message);
          apiStatus.errors.push(`${symbol}: ${error.message}`);
        }
      }
      
      // If we couldn't fetch any data and don't have previous cache, 
      // add a few reference values to show something
      if (stocksData.length === 0) {
        console.log('No data available - adding reference values');
        
        // Reference values for stocks (approximates of real values)
        const referenceData = {
          'AAPL': { price: 174.23, change: 0.95, changePercent: 0.55 },
          'MSFT': { price: 429.32, change: 2.16, changePercent: 0.51 },
          'GOOGL': { price: 163.75, change: -0.78, changePercent: -0.47 },
          'TSLA': { price: 172.63, change: -3.11, changePercent: -1.77 },
          'META': { price: 493.50, change: 3.28, changePercent: 0.67 },
          'NVDA': { price: 881.86, change: 6.93, changePercent: 0.79 },
          'BTCUSD': { price: 63758.14, change: -531.27, changePercent: -0.83 }
        };
        
        // Add reference data for a few key symbols
        const backupSymbols = ['AAPL', 'MSFT', 'BTCUSD'];
        
        for (const symbol of backupSymbols) {
          const data = referenceData[symbol];
          stocksData.push({
            symbol,
            price: data.price.toFixed(2),
            change: data.change.toFixed(2),
            changePercent: data.changePercent.toFixed(2),
            company: companyMapping[symbol] || symbol,
            lastUpdated: new Date().toISOString(),
            source: 'reference-data-fallback',
            note: 'Fallback data due to API issues'
          });
        }
      }
    }
    
    // Sort the stocks by symbol for consistent ordering
    stocksData.sort((a, b) => a.symbol.localeCompare(b.symbol));
    
    // Create response
    const response = { 
      stocks: stocksData,
      meta: {
        source: 'finnhub-real-time',
        count: stocksData.length,
        timestamp: new Date().toISOString(),
        api_status: apiStatus,
        rotation: Math.floor(new Date().getSeconds() / 10), // Current rotation
        next_update: new Date(Date.now() + 15000).toISOString() // Next potential update in 15s
      }
    };
    
    // Cache this response for a reasonable time
    stockCache = {
      lastUpdated: Date.now(),
      data: response,
      expiresAt: Date.now() + 45000 // 45 second cache - balance between freshness and API load
    };
    
    // Send the response
    res.json(response);
    
  } catch (error) {
    console.error('Error in stock API endpoint:', error);
    
    // If we have cached data, return it as a fallback
    if (stockCache.data) {
      console.log('Returning cached data due to error');
      return res.json({
        ...stockCache.data,
        meta: {
          ...stockCache.data.meta,
          cached: true,
          error: error.message
        }
      });
    }
    
    res.status(500).json({ 
      error: error.message,
      message: 'Failed to fetch stock data',
      timestamp: new Date().toISOString()
    });
  }
});

// Add a new endpoint for the timer and current timeframe with extreme rate limiting
const timerRequests = {
  clients: {},
  lastLoggedMinute: 0,
  staticResponse: null,
  staticResponseExpiry: 0
};
app.get('/api/timer', (req, res) => {
  try {
    // Always set appropriate CORS headers for this endpoint
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, Cache-Control');
    res.header('Cache-Control', 'public, max-age=60'); // Enable browser caching for 60 seconds
    
    // Check if this is an OPTIONS preflight request
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
    
    // Get client IP for rate limiting (or use a default)
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    
    // Check if this client has made too many requests recently
    const requestTime = Date.now();
    const lastRequest = timerRequests.clients[clientIp] || 0;
    
    // Check if we have a valid static response cached
    if (timerRequests.staticResponse && requestTime < timerRequests.staticResponseExpiry) {
      // Use the static response if it's valid (update timestamps)
      const cachedResponse = {...timerRequests.staticResponse};
      
      // Update current time in the cached response
      const now = new Date();
      cachedResponse.currentTime = now.toISOString();
      cachedResponse.currentTimeReadable = now.toLocaleTimeString('en-US', {
        hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: true, timeZone: 'UTC'
      });
      
      // Update the time remaining calculation
      const timeDiff = Math.max(0, new Date(cachedResponse.nextUpdateTime).getTime() - now.getTime());
      const hoursRemaining = Math.floor(timeDiff / (1000 * 60 * 60));
      const minutesRemaining = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
      const secondsRemaining = Math.floor((timeDiff % (1000 * 60)) / 1000);
      
      cachedResponse.timeRemaining = {
        hours: hoursRemaining,
        minutes: minutesRemaining,
        seconds: secondsRemaining,
        totalSeconds: Math.floor(timeDiff / 1000)
      };
      
      return res.json(cachedResponse);
    }
    
    // Extreme rate limiting - only allow a request every 60 seconds per IP
    // This is necessary to prevent browser refresh loops and excessive API calls
    if (requestTime - lastRequest < 60000) { // 60 seconds
      // Too many requests, return 429 status with cached data if available
      if (timerRequests.staticResponse) {
        // Return cached data with 429 status
        return res.status(429).json({
          ...timerRequests.staticResponse,
          error: 'Too many requests',
          message: 'Please wait at least 1 minute before making another request',
          retryAfter: Math.ceil((60000 - (requestTime - lastRequest)) / 1000),
          status: "Cached response - timer updates are rate limited to once per minute"
        });
      } else {
        // No cached data available yet
        return res.status(429).json({
          error: 'Too many requests',
          message: 'Please wait at least 1 minute before making another request',
          retryAfter: Math.ceil((60000 - (requestTime - lastRequest)) / 1000),
          currentTimeFrame: updateCurrentTimeFrame(new Date()),
          nextUpdateTime: nextScheduledUpdateTime ? nextScheduledUpdateTime.toISOString() : null,
          status: "Cached response - timer updates are rate limited to once per minute"
        });
      }
    }
    
    // Update the last request time for this client
    timerRequests.clients[clientIp] = requestTime;
    
    // Get current time
    const now = new Date();
    
    // Always update the current timeframe
    const currentTimeFrame = updateCurrentTimeFrame(now);
    
    // If nextScheduledUpdateTime is not set or is in the past, calculate it
    if (!nextScheduledUpdateTime || nextScheduledUpdateTime < now) {
      nextScheduledUpdateTime = calculateNextUpdateTime();
      console.log("Timer API: Next update time recalculated to", nextScheduledUpdateTime.toUTCString());
    }
    
    // Calculate time remaining
    const timeDiff = Math.max(0, nextScheduledUpdateTime.getTime() - now.getTime());
    const hoursRemaining = Math.floor(timeDiff / (1000 * 60 * 60));
    const minutesRemaining = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
    const secondsRemaining = Math.floor((timeDiff % (1000 * 60)) / 1000);
    
    // Create a readable time for the last update
    let lastUpdateReadable = "Not yet updated";
    if (lastUpdateTime) {
      lastUpdateReadable = new Date(lastUpdateTime).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: 'numeric',
        hour12: true,
        timeZone: 'UTC'
      });
    }
    
    // Create a readable time for the next update
    const nextUpdateReadable = new Date(nextScheduledUpdateTime).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: 'numeric',
      hour12: true,
      timeZone: 'UTC'
    });
    
    // Set proper content type for JSON
    res.setHeader('Content-Type', 'application/json');
    
    // Create the response payload
    const response = {
      currentTime: now.toISOString(),
      currentTimeReadable: now.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: true,
        timeZone: 'UTC'
      }),
      currentTimeFrame,
      nextUpdateTime: nextScheduledUpdateTime.toISOString(),
      nextUpdateReadable,
      lastUpdateTime: lastUpdateTime ? lastUpdateTime.toISOString() : null,
      lastUpdateReadable,
      timeRemaining: {
        hours: hoursRemaining,
        minutes: minutesRemaining,
        seconds: secondsRemaining,
        totalSeconds: Math.floor(timeDiff / 1000)
      },
      schedule: {
        frequency: "Every 4 hours",
        fixedTimes: "12am, 4am, 8am, 12pm, 4pm, 8pm",
        timezone: "UTC"
      }
    };
    
    // Cache this response for 60 seconds server-side
    timerRequests.staticResponse = {...response};
    timerRequests.staticResponseExpiry = requestTime + 60000;
    
    // Only log the timer request once every minute to reduce console spam
    const minuteKey = Math.floor(now.getTime() / 60000);
    if (!timerRequests.lastLoggedMinute || timerRequests.lastLoggedMinute !== minuteKey) {
      timerRequests.lastLoggedMinute = minuteKey;
      console.log(`Timer API request: Sent timeframe ${currentTimeFrame}, next update in ${hoursRemaining}h ${minutesRemaining}m ${secondsRemaining}s`);
    }
    
    // Send response
    res.json(response);
  } catch (error) {
    console.error("Error in timer endpoint:", error);
    res.status(500).json({ 
      error: error.message,
      currentTime: new Date().toISOString()
    });
  }
});

// Add a simple timer API endpoint as a backup
app.get('/api/timer-short', (req, res) => {
  try {
    // Set CORS headers
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    // Check if this is an OPTIONS preflight request
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
    
    // Send timer data
    res.json({
      timer: {
        duration: 300,
        start: new Date().toISOString(),
        end: new Date(Date.now() + 300000).toISOString(),
        status: 'active'
      },
      meta: {
        serverTime: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error in timer API:', error);
    res.status(500).json({ error: 'Failed to fetch timer data' });
  }
});

// Track whether the server is running
let isServerRunning = false;

// Add a dedicated crypto data endpoint using CoinGecko API
app.get('/api/crypto', async (req, res) => {
  try {
    // Set explicit CORS headers for this endpoint
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    
    console.log('Crypto API request received');
    
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
    
    // Create a global cache for crypto data to minimize API calls
    if (!global.cryptoCache) {
      global.cryptoCache = {
        data: null,
        lastUpdated: null,
        expiresAt: null
      };
    }
    
    const now = Date.now();
    let shouldRefreshCache = true;
    let cryptoData = [];
    
    // Check if we have valid cached data (60 seconds cache)
    if (global.cryptoCache.data && global.cryptoCache.expiresAt && now < global.cryptoCache.expiresAt) {
      console.log(`Using cached crypto data from ${new Date(global.cryptoCache.lastUpdated).toISOString()}, expires in ${Math.floor((global.cryptoCache.expiresAt - now)/1000)}s`);
      shouldRefreshCache = false;
      cryptoData = global.cryptoCache.data;
    }
    
    if (shouldRefreshCache) {
      console.log('Fetching fresh crypto data from CoinGecko');
      
      // Define popular crypto coins to track
      const coins = [
        'bitcoin', 'ethereum', 'ripple', 'cardano', 'solana', 
        'polkadot', 'dogecoin', 'avalanche-2', 'shiba-inu'
      ];
      
      // Use CoinGecko API for crypto data (no authentication required)
      const coinGeckoUrl = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${coins.join(',')}&order=market_cap_desc&per_page=15&page=1&sparkline=false&price_change_percentage=24h,7d`;
      
      try {
        const response = await axios.get(coinGeckoUrl, { 
          timeout: 8000,
          headers: {
            'Accept': 'application/json',
            'Accept-Encoding': 'gzip, deflate',
            'User-Agent': 'NovaNews/1.0 (news aggregator; development)'
          }
        });
        
        if (response.data && Array.isArray(response.data)) {
          cryptoData = response.data.map(coin => {
            return {
              id: coin.id,
              symbol: coin.symbol.toUpperCase(),
              name: coin.name,
              price: coin.current_price,
              market_cap: coin.market_cap,
              market_cap_rank: coin.market_cap_rank,
              image: coin.image,
              high_24h: coin.high_24h,
              low_24h: coin.low_24h,
              price_change_24h: coin.price_change_24h,
              price_change_percentage_24h: coin.price_change_percentage_24h,
              price_change_percentage_7d: coin.price_change_percentage_7d_in_currency,
              total_volume: coin.total_volume,
              circulating_supply: coin.circulating_supply,
              last_updated: coin.last_updated,
              ath: coin.ath,
              ath_date: coin.ath_date,
              ath_change_percentage: coin.ath_change_percentage
            };
          });
          
          // Also fetch crypto global data
          try {
            const globalResponse = await axios.get('https://api.coingecko.com/api/v3/global', {
              timeout: 5000,
              headers: {
                'Accept': 'application/json',
                'Accept-Encoding': 'gzip, deflate',
                'User-Agent': 'NovaNews/1.0 (news aggregator; development)'
              }
            });
            
            if (globalResponse.data && globalResponse.data.data) {
              const globalData = globalResponse.data.data;
              
              // Cache global market data
              global.cryptoGlobalData = {
                market_cap_usd: globalData.total_market_cap.usd,
                volume_24h_usd: globalData.total_volume.usd,
                bitcoin_dominance: globalData.market_cap_percentage.btc,
                ethereum_dominance: globalData.market_cap_percentage.eth,
                active_cryptocurrencies: globalData.active_cryptocurrencies,
                markets: globalData.markets,
                last_updated: new Date().toISOString()
              };
            }
          } catch (globalError) {
            console.error('Error fetching global crypto data:', globalError.message);
          }
          
          // Cache the data for 2 minutes
          global.cryptoCache = {
            data: cryptoData,
            lastUpdated: now,
            expiresAt: now + 120000 // 2 minutes cache to avoid rate limiting
          };
        } else {
          throw new Error('Invalid response format from CoinGecko');
        }
      } catch (coinGeckoError) {
        console.error('CoinGecko API error:', coinGeckoError.message);
        
        // If we have cached data, return it even if expired
        if (global.cryptoCache && global.cryptoCache.data) {
          console.log('Using expired cache due to CoinGecko API error');
          cryptoData = global.cryptoCache.data;
          
          // Extend the cache expiration to avoid hammering the API during outages
          global.cryptoCache.expiresAt = now + 300000; // 5 minutes
        } else {
          throw new Error('No cached data available and CoinGecko API request failed');
        }
      }
    }
    
    // Construct the final response
    const response = {
      data: cryptoData,
      meta: {
        count: cryptoData.length,
        source: 'coingecko',
        timestamp: new Date().toISOString(),
        cached: !shouldRefreshCache,
        next_update: global.cryptoCache.expiresAt ? new Date(global.cryptoCache.expiresAt).toISOString() : null
      },
      global: global.cryptoGlobalData || {}
    };
    
    res.json(response);
    
  } catch (error) {
    console.error('Error in crypto API endpoint:', error);
    
    // Check if we have any cached data as fallback
    if (global.cryptoCache && global.cryptoCache.data) {
      console.log('Returning cached crypto data due to error');
      return res.json({
        data: global.cryptoCache.data,
        meta: {
          count: global.cryptoCache.data.length,
          source: 'coingecko',
          timestamp: new Date().toISOString(),
          cached: true,
          error: error.message,
          next_update: new Date(Date.now() + 30000).toISOString() // Try again in 30 seconds
        },
        global: global.cryptoGlobalData || {}
      });
    }
    
    // If we have no cached data, return an error
    res.status(500).json({
      error: error.message,
      message: 'Failed to fetch crypto data',
      timestamp: new Date().toISOString()
    });
  }
});

// Add a dedicated crypto market charts endpoint
app.get('/api/crypto/chart/:id', async (req, res) => {
  try {
    // Set CORS headers
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    // Get coin ID from request params
    const { id } = req.params;
    const days = req.query.days || '7'; // Default 7 days
    const interval = req.query.interval || 'daily'; // Default daily interval
    
    if (!id) {
      return res.status(400).json({ error: 'Coin ID is required' });
    }
    
    // Create a cache key for this specific request
    const cacheKey = `chart_${id}_${days}_${interval}`;
    
    // Initialize cache if not exists
    if (!global.cryptoChartCache) {
      global.cryptoChartCache = {};
    }
    
    // Check for valid cached data
    const now = Date.now();
    if (global.cryptoChartCache[cacheKey] && 
        global.cryptoChartCache[cacheKey].expiresAt > now) {
      console.log(`Using cached chart data for ${id}`);
      return res.json(global.cryptoChartCache[cacheKey].data);
    }
    
    console.log(`Fetching chart data for ${id}, days=${days}, interval=${interval}`);
    
    // Fetch chart data from CoinGecko
    const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}&interval=${interval}`;
    try {
      const response = await axios.get(url, {
        timeout: 8000,
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'User-Agent': 'NovaNews/1.0 (news aggregator; development)'
        }
      });
      
      if (response.data) {
        // Process and format the data
        const { prices, market_caps, total_volumes } = response.data;
        
        // Convert times from ms to formatted date strings and extract price data
        const formattedData = {
          labels: prices.map(item => new Date(item[0]).toISOString()),
          prices: prices.map(item => item[1]),
          market_caps: market_caps.map(item => item[1]),
          total_volumes: total_volumes.map(item => item[1]),
          coin_id: id,
          days: days,
          interval: interval
        };
        
        // Cache the data
        const cacheTime = parseInt(days) > 7 ? 3600000 : 1800000; // 1 hour for long-term data, 30 min for short-term
        global.cryptoChartCache[cacheKey] = {
          data: formattedData,
          expiresAt: now + cacheTime
        };
        
        res.json(formattedData);
      } else {
        throw new Error('Invalid chart data response');
      }
    } catch (chartError) {
      console.error(`Error fetching chart data for ${id}:`, chartError.message);
      
      // If we have cached data, return it even if expired
      if (global.cryptoChartCache[cacheKey] && global.cryptoChartCache[cacheKey].data) {
        console.log(`Using expired cache for ${id} chart due to API error`);
        return res.json({
          ...global.cryptoChartCache[cacheKey].data,
          cached: true,
          error: 'Using cached data due to API error'
        });
      }
      
      res.status(500).json({
        error: chartError.message,
        message: 'Failed to fetch chart data',
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error(`Error in crypto chart endpoint:`, error.message);
    res.status(500).json({
      error: error.message,
      message: 'Failed to process chart data request',
      timestamp: new Date().toISOString()
    });
  }
});

// Add this endpoint after the other endpoints
// Crypto news endpoint for article detail pages
app.get('/api/crypto-news', async (req, res) => {
  try {
    console.log('Crypto News API request received');
    
    // Set CORS headers
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    // Handle preflight
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
    
    // Get crypto news
    const news = await fetchCryptoNews();
    
    // Return the news
    res.json({
      status: 'success',
      data: news,
      count: news.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in Crypto News API endpoint:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch crypto news',
      error: error.message
    });
  }
});

// Add a timer endpoint that provides update schedule information
app.get('/api/timer', (req, res) => {
  try {
    console.log('Timer API request received');
    
    // Set CORS headers
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    // Handle preflight
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    const now = new Date();
    
    // Calculate time remaining until next update
    const timeRemaining = nextScheduledUpdateTime ? 
      Math.max(0, nextScheduledUpdateTime.getTime() - now.getTime()) : 0;
    
    const hours = Math.floor(timeRemaining / (1000 * 60 * 60));
    const minutes = Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((timeRemaining % (1000 * 60)) / 1000);
    const totalSeconds = Math.floor(timeRemaining / 1000);
    
    // Get current time frame
    const currentTimeFrame = updateCurrentTimeFrame(now);
    
    // Format readable times
    const formatReadableTime = (date) => {
      if (!date) return null;
      return date.toLocaleString('en-US', { 
        weekday: 'short',
        month: 'short', 
        day: 'numeric',
        hour: '2-digit', 
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short'
      });
    };
    
    const response = {
      currentTime: now.toISOString(),
      currentTimeReadable: formatReadableTime(now),
      currentTimeFrame: currentTimeFrame,
      nextUpdateTime: nextScheduledUpdateTime ? nextScheduledUpdateTime.toISOString() : null,
      nextUpdateReadable: formatReadableTime(nextScheduledUpdateTime),
      lastUpdateTime: lastUpdateTime ? lastUpdateTime.toISOString() : null,
      lastUpdateReadable: formatReadableTime(lastUpdateTime),
      timeRemaining: {
        hours,
        minutes,
        seconds,
        totalSeconds
      },
      schedule: {
        frequency: '4 hours',
        fixedTimes: '12am, 4am, 8am, 12pm, 4pm, 8pm UTC',
        timezone: 'UTC'
      }
    };
    
    res.json(response);
  } catch (error) {
    console.error('Error in Timer API endpoint:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch timer data',
      error: error.message
    });
  }
});

// Get active articles endpoint (only returns current articles in active status)
app.get('/api/articles', async (req, res) => {
  try {
    console.log('Articles API request received for active articles');
    
    // Set CORS headers
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    // Handle preflight
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
    
    // Get category filter if provided
    const category = req.query.category;
    const limit = parseInt(req.query.limit) || 20;
    const page = parseInt(req.query.page) || 1;
    const offset = (page - 1) * limit;
    
    // Build query using status column
    let query = supabase
      .from('articles')
      .select('*')
      .eq('status', 'active') // Only active articles
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    
    // Add category filter if provided
    if (category) {
      query = query.eq('category', category);
    }
    
    // Execute query
    const { data, error } = await query;
    
    if (error) {
      console.error('Error fetching articles:', error);
      return res.status(500).json({ error: error.message });
    }
    
    // Get total count for pagination
    const { count: totalCount, error: countError } = await supabase
      .from('articles')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active');
    
    if (countError) {
      console.error('Error counting articles:', countError);
    }
    
    res.json({
      articles: data || [],
      pagination: {
        total: totalCount || 0,
        page,
        limit,
        pages: Math.ceil((totalCount || 0) / limit)
      },
      timeframe: updateCurrentTimeFrame(new Date()),
      nextUpdate: nextScheduledUpdateTime ? nextScheduledUpdateTime.toISOString() : null
    });
  } catch (error) {
    console.error('Error in articles endpoint:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get archived articles endpoint (only returns articles in archived status)
app.get('/api/articles/archived', async (req, res) => {
  try {
    console.log('Articles API request received for archived articles');
    
    // Set CORS headers
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    // Handle preflight
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
    
    // Get category filter if provided
    const category = req.query.category;
    const limit = parseInt(req.query.limit) || 20;
    const page = parseInt(req.query.page) || 1;
    const offset = (page - 1) * limit;
    
    // Build query using status column
    let query = supabase
      .from('articles')
      .select('*')
      .eq('status', 'archived') // Only archived articles
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    
    // Add category filter if provided
    if (category) {
      query = query.eq('category', category);
    }
    
    // Execute query
    const { data, error } = await query;
    
    if (error) {
      console.error('Error fetching archived articles:', error);
      return res.status(500).json({ error: error.message });
    }
    
    // Get total count for pagination
    const { count: totalCount, error: countError } = await supabase
      .from('articles')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'archived');
    
    if (countError) {
      console.error('Error counting archived articles:', countError);
    }
    
    res.json({
      articles: data || [],
      pagination: {
        total: totalCount || 0,
        page,
        limit,
        pages: Math.ceil((totalCount || 0) / limit)
      },
      timeframe: updateCurrentTimeFrame(new Date()),
      nextUpdate: nextScheduledUpdateTime ? nextScheduledUpdateTime.toISOString() : null
    });
  } catch (error) {
    console.error('Error in archived articles endpoint:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add endpoint to check article lifecycle status
app.get('/api/lifecycle-status', async (req, res) => {
  try {
    console.log('Lifecycle status API request received');
    
    // Handle preflight
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
    
    // Get counts of articles by status
    let activeCount = 0;
    let archivedCount = 0;
    let newestActive = null;
    let oldestActive = null;
    let newestArchived = null;
    let oldestArchived = null;
    let recentActivity = [];
    
    try {
      const { data: activeArticles, error: activeError } = await supabase
        .from('articles')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active');
      
      if (activeError) {
        console.error('Error counting active articles:', activeError);
      } else if (activeArticles !== null) {
        activeCount = activeArticles.count || 0;
      } else {
        console.log('Active articles query returned null, using default count of 0');
      }
    } catch (err) {
      console.error('Error querying active articles:', err);
    }
    
    try {
      const { data: archivedArticles, error: archivedError } = await supabase
        .from('articles')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'archived');
      
      if (archivedError) {
        console.error('Error counting archived articles:', archivedError);
      } else if (archivedArticles !== null) {
        archivedCount = archivedArticles.count || 0;
      } else {
        console.log('Archived articles query returned null, using default count of 0');
      }
    } catch (err) {
      console.error('Error querying archived articles:', err);
    }
    
    // Try to get newest/oldest active articles
    try {
      const { data: newest, error: newestError } = await supabase
        .from('articles')
        .select('id, title, created_at')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1);
      
      if (!newestError && newest && newest.length > 0) {
        newestActive = newest[0];
      }
    } catch (err) {
      console.error('Error fetching newest active article:', err);
    }
    
    try {
      const { data: oldest, error: oldestError } = await supabase
        .from('articles')
        .select('id, title, created_at')
        .eq('status', 'active')
        .order('created_at', { ascending: true })
        .limit(1);
      
      if (!oldestError && oldest && oldest.length > 0) {
        oldestActive = oldest[0];
      }
    } catch (err) {
      console.error('Error fetching oldest active article:', err);
    }
    
    // Try to get newest/oldest archived articles
    try {
      const { data: newest, error: newestError } = await supabase
        .from('articles')
        .select('id, title, created_at')
        .eq('status', 'archived')
        .order('created_at', { ascending: false })
        .limit(1);
      
      if (!newestError && newest && newest.length > 0) {
        newestArchived = newest[0];
      }
    } catch (err) {
      console.error('Error fetching newest archived article:', err);
    }
    
    try {
      const { data: oldest, error: oldestError } = await supabase
        .from('articles')
        .select('id, title, created_at')
        .eq('status', 'archived')
        .order('created_at', { ascending: true })
        .limit(1);
      
      if (!oldestError && oldest && oldest.length > 0) {
        oldestArchived = oldest[0];
      }
    } catch (err) {
      console.error('Error fetching oldest archived article:', err);
    }
    
    // Calculate next lifecycle events
    const now = new Date();
    let nextArchiveEvent = null;
    let nextDeleteEvent = null;
    
    if (oldestActive) {
      const oldestActiveDate = new Date(oldestActive.created_at);
      const fourHoursAfterCreation = new Date(oldestActiveDate.getTime() + 4 * 60 * 60 * 1000);
      if (fourHoursAfterCreation > now) {
        nextArchiveEvent = {
          articleId: oldestActive.id,
          articleTitle: oldestActive.title,
          created: oldestActiveDate.toISOString(),
          willBeArchivedAt: fourHoursAfterCreation.toISOString(),
          timeRemaining: Math.max(0, Math.floor((fourHoursAfterCreation.getTime() - now.getTime()) / 1000))
        };
      }
    }
    
    if (oldestArchived) {
      const oldestArchivedDate = new Date(oldestArchived.created_at);
      const eightHoursAfterCreation = new Date(oldestArchivedDate.getTime() + 8 * 60 * 60 * 1000);
      if (eightHoursAfterCreation > now) {
        nextDeleteEvent = {
          articleId: oldestArchived.id,
          articleTitle: oldestArchived.title,
          created: oldestArchivedDate.toISOString(),
          willBeDeletedAt: eightHoursAfterCreation.toISOString(),
          timeRemaining: Math.max(0, Math.floor((eightHoursAfterCreation.getTime() - now.getTime()) / 1000))
        };
      }
    }
    
    // Try to get recent lifecycle activity
    try {
      const { data: recent, error: recentError } = await supabase
        .from('lifecycle_log')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(10);
      
      if (!recentError && recent) {
        recentActivity = recent;
      } else if (recentError) {
        // The table might not exist
        console.log('Could not fetch lifecycle activity - table may not exist:', recentError.message);
        recentActivity = [{
          id: 0,
          action: 'info',
          article_title: 'Lifecycle logging not available',
          details: { info: 'Lifecycle log table may not exist in the database' },
          timestamp: new Date().toISOString()
        }];
      }
    } catch (err) {
      console.error('Error fetching recent lifecycle activity:', err);
      // This might be because the table doesn't exist yet
      console.log('The lifecycle_log table might not exist yet');
      recentActivity = [{
        id: 0,
        action: 'info',
        article_title: 'Lifecycle logging not available',
        details: { error: err.message },
        timestamp: new Date().toISOString()
      }];
    }
    
    // Return the lifecycle status
    res.json({
      status: 'success',
      currentTime: now.toISOString(),
      counts: {
        active: activeCount,
        archived: archivedCount,
        total: activeCount + archivedCount
      },
      articles: {
        newestActive,
        oldestActive,
        newestArchived,
        oldestArchived
      },
      nextEvents: {
        archive: nextArchiveEvent,
        delete: nextDeleteEvent
      },
      recentActivity,
      lifecycleRules: {
        activeToArchive: '4 hours after creation',
        archiveToDelete: '8 hours after creation (4 hours in archive)'
      }
    });
  } catch (error) {
    console.error('Error in lifecycle status endpoint:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch lifecycle status',
      error: error.message
    });
  }
});

// Article Reactions endpoints
app.get('/api/reactions/:articleId', async (req, res) => {
  try {
    const { articleId } = req.params;
    const ifNoneMatch = req.headers['if-none-match'];
    
    if (!articleId) {
      return res.status(400).json({ error: 'Article ID is required' });
    }
    
    // Get the current ETag for this article's reactions
    const etag = `W/"article-${articleId}-${Date.now()}"`;
    
    // Query the database for reactions
    const { data, error } = await supabase
      .from('article_reactions')
      .select('*')
      .eq('article_id', articleId)
      .single();
    
    if (error && error.code !== 'PGRST116') { // PGRST116 is "No rows returned"
      console.error(`Error fetching article reactions:`, error);
      throw new Error(error.message);
    }
    
    // If no reactions found, initialize with zeros
    if (!data) {
      // Create a new record in the database with zero counts
      const { data: newData, error: insertError } = await supabase
        .from('article_reactions')
        .insert([
          { 
            article_id: articleId,
            helpful_count: 0,
            love_count: 0,
            insightful_count: 0,
            concerning_count: 0
          }
        ])
        .select()
        .single();
      
      if (insertError) {
        console.error(`Error creating article reactions:`, insertError);
        // Fall back to returning zeros without database entry
        return res
          .set({
            'Cache-Control': 'no-cache',
            'ETag': etag
          })
          .json({
            helpful: 0,
            love: 0,
            insightful: 0,
            concerning: 0
          });
      }
      
      return res
        .set({
          'Cache-Control': 'no-cache',
          'ETag': etag
        })
        .json({
          helpful: newData.helpful_count,
          love: newData.love_count,
          insightful: newData.insightful_count,
          concerning: newData.concerning_count
        });
    }
    
    // Generate a hash of the data for ETag
    const responseData = {
      helpful: data.helpful_count,
      love: data.love_count,
      insightful: data.insightful_count,
      concerning: data.concerning_count
    };
    
    // Add cache control headers
    res.set({
      'Cache-Control': 'no-cache',
      'ETag': etag
    });
    
    // Return existing reaction counts
    return res.json(responseData);
  } catch (error) {
    console.error(`Error in reactions GET endpoint:`, error);
    res.status(500).json({
      error: error.message,
      message: 'Failed to fetch article reactions'
    });
  }
});

app.post('/api/reactions/:articleId', async (req, res) => {
  try {
    const { articleId } = req.params;
    const { type, add, initialize, counts } = req.body;
    
    if (!articleId) {
      return res.status(400).json({ error: 'Article ID is required' });
    }
    
    // Handle initialization with custom counts
    if (initialize && counts) {
      // Check if record already exists
      const { data: existingData, error: checkError } = await supabase
        .from('article_reactions')
        .select('*')
        .eq('article_id', articleId)
        .single();

      // Only insert if no record exists
      if (!existingData) {
        // Insert new record with provided counts
        const { data: newData, error: insertError } = await supabase
          .from('article_reactions')
          .insert([
            { 
              article_id: articleId,
              helpful_count: counts.helpful || 0,
              love_count: counts.love || 0,
              insightful_count: counts.insightful || 0,
              concerning_count: counts.concerning || 0
            }
          ])
          .select()
          .single();
        
        if (insertError) {
          console.error(`Error initializing article reactions:`, insertError);
          return res.status(500).json({
            error: insertError.message,
            message: 'Failed to initialize article reactions'
          });
        }
        
        // Send with cache control headers
        res.set('Cache-Control', 'no-cache');
        return res.json({
          helpful: newData.helpful_count,
          love: newData.love_count,
          insightful: newData.insightful_count,
          concerning: newData.concerning_count
        });
      } else {
        // Return existing data
        res.set('Cache-Control', 'no-cache');
        return res.json({
          helpful: existingData.helpful_count,
          love: existingData.love_count,
          insightful: existingData.insightful_count,
          concerning: existingData.concerning_count
        });
      }
    }
    
    // Regular reaction update from here
    if (!type) {
      return res.status(400).json({ error: 'Reaction type is required' });
    }
    
    // Map reaction type to database column
    const columnMap = {
      helpful: 'helpful_count',
      love: 'love_count',
      insightful: 'insightful_count',
      concerning: 'concerning_count'
    };
    
    const column = columnMap[type];
    
    if (!column) {
      return res.status(400).json({ error: 'Invalid reaction type' });
    }
    
    // First check if record exists
    const { data: existingData, error: fetchError } = await supabase
      .from('article_reactions')
      .select('*')
      .eq('article_id', articleId)
      .single();
    
    if (fetchError && fetchError.code !== 'PGRST116') {
      console.error(`Error fetching article reactions:`, fetchError);
      throw new Error(fetchError.message);
    }
    
    let data;
    let error;
    
    // If no existing record, create one
    if (!existingData) {
      // Set up initial reaction counts
      const initialCounts = {
        article_id: articleId,
        helpful_count: 0,
        love_count: 0,
        insightful_count: 0,
        concerning_count: 0
      };
      
      // Update the specific reaction count
      initialCounts[column] = add ? 1 : 0;
      
      // Insert new record
      const result = await supabase
        .from('article_reactions')
        .insert([initialCounts])
        .select()
        .single();
      
      data = result.data;
      error = result.error;
    } else {
      // Update existing record
      const updates = {};
      
      // Calculate new value (ensure it doesn't go below 0)
      const newValue = Math.max(0, existingData[column] + (add ? 1 : -1));
      updates[column] = newValue;
      
      // Update the record
      const result = await supabase
        .from('article_reactions')
        .update(updates)
        .eq('article_id', articleId)
        .select()
        .single();
      
      data = result.data;
      error = result.error;
    }
    
    if (error) {
      console.error(`Error updating article reactions:`, error);
      throw new Error(error.message);
    }
    
    // Return updated reaction counts with cache control headers
    res.set('Cache-Control', 'no-cache');
    return res.json({
      helpful: data.helpful_count,
      love: data.love_count,
      insightful: data.insightful_count,
      concerning: data.concerning_count
    });
  } catch (error) {
    console.error(`Error in reactions POST endpoint:`, error);
    res.status(500).json({
      error: error.message,
      message: 'Failed to update article reactions'
    });
  }
});

// Add page view endpoint
app.post('/api/page-view/:articleId', async (req, res) => {
  try {
    const { articleId } = req.params;
    const { pageViewId } = req.body;
    
    if (!articleId) {
      return res.status(400).json({ error: 'Article ID is required' });
    }
    
    // Optional: record page view in database if needed
    // This is a simple implementation that just acknowledges the view
    // You could extend this to store in Supabase if needed
    
    console.log(`Page view recorded for article ${articleId} with pageViewId ${pageViewId}`);
    
    // Return success
    return res.status(200).json({ 
      success: true,
      message: 'Page view recorded'
    });
  } catch (error) {
    console.error(`Error recording page view:`, error);
    // Return 200 anyway to not disrupt user experience
    return res.status(200).json({
      success: false,
      message: 'Failed to record page view, but continuing'
    });
  }
});

// Mock announcements data - replace with database in production
const announcements = [
  {
    id: '1',
    title: 'System Maintenance',
    content: 'Scheduled maintenance on June 25th from 2-4 AM EST. Some services may be unavailable.',
    priority: 'medium',
    is_active: true,
    expires_at: '2023-06-26T04:00:00Z',
    created_at: '2023-06-20T12:00:00Z'
  },
  {
    id: '2',
    title: 'Market Volatility',
    content: 'High market volatility expected due to upcoming Fed announcements. Please check your positions regularly.',
    priority: 'high',
    is_active: true,
    expires_at: null,
    created_at: '2023-06-21T09:30:00Z'
  },
  {
    id: '3',
    title: 'CRITICAL: Important Security Update',
    content: 'Please update your account security settings by logging in and visiting the security tab.',
    priority: 'high', // Using 'high' but will display as critical due to "CRITICAL" in title
    is_active: true,
    expires_at: null,
    created_at: '2023-06-22T10:00:00Z'
  }
];

// Announcements API endpoints
app.get('/api/announcements', (req, res) => {
  try {
    // Only return active announcements that haven't expired
    const now = new Date().toISOString();
    const activeAnnouncements = announcements.filter(a => 
      a.is_active && (!a.expires_at || a.expires_at > now)
    );
    
    // Sort by priority (higher priority first)
    activeAnnouncements.sort((a, b) => {
      const priorityMap = {
        'low': 1,
        'medium': 2,
        'high': 3,
        'critical': 4
      };
      return priorityMap[b.priority] - priorityMap[a.priority];
    });
    
    res.json(activeAnnouncements);
  } catch (error) {
    console.error('Error fetching announcements:', error);
    res.status(500).json({ error: 'Failed to fetch announcements' });
  }
});

// Create announcement
app.post('/api/announcements', (req, res) => {
  try {
    const { title, content, priority, is_active, expires_at } = req.body;
    
    if (!title || !content) {
      return res.status(400).json({ error: 'Title and content are required' });
    }
    
    // Handle priority mapping to ensure compatibility with database constraints
    let safePriority = priority || 'medium';
    if (safePriority === 'critical') {
      // Convert 'critical' to 'high' if needed for database compatibility
      console.log('Converting critical priority to high for database compatibility');
      safePriority = 'high';
    }
    
    // Ensure priority is one of the allowed values
    if (!['low', 'medium', 'high'].includes(safePriority)) {
      safePriority = 'medium'; // Default to medium if invalid
    }
    
    // Create a new announcement
    const newAnnouncement = {
      id: Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15),
      title,
      content,
      priority: safePriority,
      is_active: is_active !== undefined ? is_active : true,
      expires_at: expires_at || null,
      created_at: new Date().toISOString()
    };
    
    // Add to announcements array
    announcements.unshift(newAnnouncement);
    
    console.log(`Created new announcement: ${newAnnouncement.title}`);
    res.status(201).json(newAnnouncement);
  } catch (error) {
    console.error('Error creating announcement:', error);
    res.status(500).json({ error: 'Failed to create announcement' });
  }
});

// Update announcement
app.put('/api/announcements/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, priority, is_active, expires_at } = req.body;
    
    // Find the announcement
    const announcementIndex = announcements.findIndex(a => a.id === id);
    
    if (announcementIndex === -1) {
      return res.status(404).json({ error: 'Announcement not found' });
    }
    
    // Handle priority mapping
    let safePriority = priority;
    if (safePriority === 'critical') {
      // Convert 'critical' to 'high' if needed for database compatibility
      console.log('Converting critical priority to high for database compatibility');
      safePriority = 'high';
    }
    
    // Update the announcement
    const updatedAnnouncement = {
      ...announcements[announcementIndex],
      title: title || announcements[announcementIndex].title,
      content: content || announcements[announcementIndex].content,
      priority: safePriority || announcements[announcementIndex].priority,
      is_active: is_active !== undefined ? is_active : announcements[announcementIndex].is_active,
      expires_at: expires_at !== undefined ? expires_at : announcements[announcementIndex].expires_at,
      updated_at: new Date().toISOString()
    };
    
    announcements[announcementIndex] = updatedAnnouncement;
    
    console.log(`Updated announcement: ${updatedAnnouncement.title}`);
    res.json(updatedAnnouncement);
  } catch (error) {
    console.error('Error updating announcement:', error);
    res.status(500).json({ error: 'Failed to update announcement' });
  }
});

// Delete announcement
app.delete('/api/announcements/:id', (req, res) => {
  try {
    const { id } = req.params;
    
    // Find the announcement
    const announcementIndex = announcements.findIndex(a => a.id === id);
    
    if (announcementIndex === -1) {
      return res.status(404).json({ error: 'Announcement not found' });
    }
    
    // Remove the announcement
    const deletedAnnouncement = announcements.splice(announcementIndex, 1)[0];
    
    console.log(`Deleted announcement: ${deletedAnnouncement.title}`);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting announcement:', error);
    res.status(500).json({ error: 'Failed to delete announcement' });
  }
});

// Function to manage the lifecycle of articles (archive/delete old ones)
async function manageArticleLifecycle() {
  try {
    console.log("Starting article lifecycle management...");
    const now = new Date();
    
    // 1. Archive articles older than 7 days
    const archiveDate = new Date(now);
    archiveDate.setDate(archiveDate.getDate() - 7);
    
    // First find all active articles older than 7 days
    const { data: oldArticles, error: findError } = await supabase
      .from('articles')
      .select('id, title, created_at')
      .eq('status', 'active')
      .lt('created_at', archiveDate.toISOString())
      .order('created_at', { ascending: true })
      .limit(100);
    
    if (findError) {
      console.error("Error finding old articles to archive:", findError);
    } else if (oldArticles && oldArticles.length > 0) {
      console.log(`Found ${oldArticles.length} old articles to archive`);
      
      // Update these articles to archived status
      const { data: archivedData, error: archiveError } = await supabase
        .from('articles')
        .update({ status: 'archived', updated_at: now.toISOString() })
        .in('id', oldArticles.map(a => a.id));
      
      if (archiveError) {
        console.error("Error archiving old articles:", archiveError);
      } else {
        console.log(`Successfully archived ${oldArticles.length} articles`);
      }
    } else {
      console.log("No articles found to archive");
    }
    
    // 2. Delete archived articles older than 30 days (permanent deletion)
    const deleteDate = new Date(now);
    deleteDate.setDate(deleteDate.getDate() - 30);
    
    // First find very old archived articles to delete
    const { data: veryOldArticles, error: findOldError } = await supabase
      .from('articles')
      .select('id, title, created_at')
      .eq('status', 'archived')
      .lt('created_at', deleteDate.toISOString())
      .order('created_at', { ascending: true })
      .limit(50);
    
    if (findOldError) {
      console.error("Error finding very old articles to delete:", findOldError);
    } else if (veryOldArticles && veryOldArticles.length > 0) {
      console.log(`Found ${veryOldArticles.length} very old articles to delete`);
      
      // Delete these articles permanently
      const { data: deletedData, error: deleteError } = await supabase
        .from('articles')
        .delete()
        .in('id', veryOldArticles.map(a => a.id));
      
      if (deleteError) {
        console.error("Error deleting very old articles:", deleteError);
      } else {
        console.log(`Successfully deleted ${veryOldArticles.length} old archived articles`);
      }
    } else {
      console.log("No archived articles found to delete");
    }
    
    return { success: true };
  } catch (error) {
    console.error("Error in article lifecycle management:", error);
    return { success: false, error: error.message };
  }
}

// Enhanced timer API endpoint with detailed information
app.get('/api/timer', (req, res) => {
  try {
    // Always set appropriate CORS headers for this endpoint
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, Cache-Control');
    res.header('Cache-Control', 'public, max-age=60'); // Enable browser caching for 60 seconds
    
    // Check if this is an OPTIONS preflight request
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
    
    // Get client IP for rate limiting (or use a default)
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    
    // Get current time
    const now = new Date();
    
    // Always update the current timeframe
    const currentTimeFrame = updateCurrentTimeFrame(now);
    
    // If nextScheduledUpdateTime is not set or is in the past, calculate it
    if (!nextScheduledUpdateTime || nextScheduledUpdateTime < now) {
      nextScheduledUpdateTime = calculateNextUpdateTime();
      console.log("Timer API: Next update time recalculated to", nextScheduledUpdateTime.toUTCString());
    }
    
    // Calculate time remaining
    const timeDiff = Math.max(0, nextScheduledUpdateTime.getTime() - now.getTime());
    const hoursRemaining = Math.floor(timeDiff / (1000 * 60 * 60));
    const minutesRemaining = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
    const secondsRemaining = Math.floor((timeDiff % (1000 * 60)) / 1000);
    
    // Create a readable time for the last update
    let lastUpdateReadable = "Not yet updated";
    if (lastUpdateTime) {
      lastUpdateReadable = new Date(lastUpdateTime).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: 'numeric',
        hour12: true,
        timeZone: 'UTC'
      });
    }
    
    // Format current time nicely
    const currentTimeReadable = now.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: true,
      timeZone: 'UTC'
    });
    
    // Create a readable time for the next update
    const nextUpdateReadable = new Date(nextScheduledUpdateTime).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: 'numeric',
      hour12: true,
      timeZone: 'UTC'
    });
    
    // Create the response payload
    const response = {
      currentTime: now.toISOString(),
      currentTimeReadable,
      currentTimeFrame,
      nextUpdateTime: nextScheduledUpdateTime.toISOString(),
      nextUpdateReadable,
      lastUpdateTime: lastUpdateTime ? lastUpdateTime.toISOString() : null,
      lastUpdateReadable,
      timeRemaining: {
        hours: hoursRemaining,
        minutes: minutesRemaining,
        seconds: secondsRemaining,
        totalSeconds: Math.floor(timeDiff / 1000)
      },
      isProcessingNews,
      updateStatus: isProcessingNews ? "in_progress" : "waiting",
      schedule: {
        frequency: "Every 4 hours",
        fixedTimes: "12am, 4am, 8am, 12pm, 4pm, 8pm UTC",
        timezone: "UTC"
      }
    };
    
    // Send response
    res.json(response);
  } catch (error) {
    console.error("Error in timer endpoint:", error);
    res.status(500).json({ 
      error: error.message,
      currentTime: new Date().toISOString()
    });
  }
});

// Force news generation endpoint (protected with a simple API key)
app.post('/api/admin/force-news-generation', async (req, res) => {
  try {
    // Basic security check - require a valid API key
    const apiKey = req.headers['x-api-key'];
    const validApiKey = process.env.ADMIN_API_KEY || 'dev-admin-key';
    
    if (!apiKey || apiKey !== validApiKey) {
      console.warn(`Unauthorized attempt to force news generation from IP: ${req.ip}`);
      return res.status(401).json({ error: 'Unauthorized. Invalid or missing API key.' });
    }
    
    console.log('Received request to force news generation');
    
    // Trigger the news process with force=true to override any in-progress check
    const result = await processNews(true);
    
    // Set next scheduled update time after the forced run
    nextScheduledUpdateTime = calculateNextUpdateTime();
    
    // Return response with status
    res.json({
      success: result.success,
      message: result.success 
        ? `Successfully processed news. Created ${result.articlesCreated} articles.` 
        : `Failed to process news: ${result.error}`,
      nextScheduledUpdate: nextScheduledUpdateTime.toISOString()
    });
  } catch (error) {
    console.error('Error in force news generation endpoint:', error);
    res.status(500).json({ error: error.message });
  }
});

// Initialize by calculating the next update time when the server starts
console.log("Initializing news update timer...");
nextScheduledUpdateTime = calculateNextUpdateTime();
console.log(`Initial news update scheduled for: ${nextScheduledUpdateTime.toUTCString()}`);

/**
 * Fetches the latest stock data for news generation
 * @returns {Promise<Array>} Array of stock data objects
 */
async function getLatestStockData() {
  try {
    console.log("Fetching latest stock data...");
    
    // First try to get stock data from the database
    const { data: dbStocks, error: dbError } = await supabase
      .from('stocks')
      .select('*')
      .order('market_cap', { ascending: false })
      .limit(30);
    
    if (dbError) {
      console.error("Error fetching stocks from database:", dbError);
      throw dbError;
    }
    
    if (dbStocks && dbStocks.length > 0) {
      console.log(`Retrieved ${dbStocks.length} stocks from database`);
      return dbStocks.map(stock => ({
        symbol: stock.symbol,
        name: stock.name,
        sector: stock.sector || 'Technology', // Default to technology if no sector
        price: stock.current_price || 0,
        change: stock.price_change_percent || 0,
        volume: stock.volume || 0,
        marketCap: stock.market_cap || 0
      }));
    }
    
    // If no data in DB, use fallback hardcoded data (this should rarely happen in production)
    console.log("No stocks found in database, using fallback data");
    return [
      { symbol: 'AAPL', name: 'Apple Inc.', sector: 'Technology', price: 180.95, change: 1.2, volume: 78400000, marketCap: 2850000000000 },
      { symbol: 'MSFT', name: 'Microsoft Corporation', sector: 'Technology', price: 378.92, change: 0.8, volume: 25600000, marketCap: 2820000000000 },
      { symbol: 'AMZN', name: 'Amazon.com Inc.', sector: 'Consumer Goods', price: 178.12, change: -0.5, volume: 30500000, marketCap: 1850000000000 },
      { symbol: 'GOOGL', name: 'Alphabet Inc.', sector: 'Technology', price: 142.65, change: 0.3, volume: 18200000, marketCap: 1790000000000 },
      { symbol: 'META', name: 'Meta Platforms Inc.', sector: 'Technology', price: 486.18, change: 2.1, volume: 15800000, marketCap: 1240000000000 },
      { symbol: 'TSLA', name: 'Tesla Inc.', sector: 'Consumer Goods', price: 175.34, change: -2.8, volume: 125600000, marketCap: 556000000000 },
      { symbol: 'JNJ', name: 'Johnson & Johnson', sector: 'Healthcare', price: 152.49, change: 0.2, volume: 6800000, marketCap: 398000000000 },
      { symbol: 'PFE', name: 'Pfizer Inc.', sector: 'Healthcare', price: 28.15, change: -0.5, volume: 38400000, marketCap: 159000000000 },
      { symbol: 'JPM', name: 'JPMorgan Chase & Co.', sector: 'Finance', price: 197.45, change: 1.0, volume: 9300000, marketCap: 570000000000 },
      { symbol: 'BAC', name: 'Bank of America Corp.', sector: 'Finance', price: 39.20, change: 0.8, volume: 42600000, marketCap: 310000000000 },
      { symbol: 'XOM', name: 'Exxon Mobil Corporation', sector: 'Energy', price: 116.24, change: -0.3, volume: 15700000, marketCap: 462000000000 },
      { symbol: 'CVX', name: 'Chevron Corporation', sector: 'Energy', price: 154.66, change: 0.5, volume: 8200000, marketCap: 291000000000 }
    ];
  } catch (error) {
    console.error("Error in getLatestStockData:", error);
    throw error;
  }
}

/**
 * Generates news content based on stock data and category
 * @param {Array} stocks - Array of stock objects to base news on
 * @param {string} category - News category
 * @returns {Promise<Object>} Generated news title and content
 */
async function generateNewsContent(stocks, category) {
  try {
    console.log(`Generating news content for ${category} using ${stocks.length} stocks`);
    
    // Prepare stock data for the prompt
    const stocksInfo = stocks.map(stock => {
      return `- ${stock.symbol} (${stock.name}): $${stock.price} (${stock.change >= 0 ? '+' : ''}${stock.change}%)`;
    }).join('\n');
    
    // Generate a market trend description
    const marketTrend = stocks.reduce((sum, stock) => sum + stock.change, 0) / stocks.length;
    const trendDescription = marketTrend > 1 ? 'bullish' : 
                            marketTrend > 0.2 ? 'positive' : 
                            marketTrend > -0.2 ? 'mixed' : 
                            marketTrend > -1 ? 'negative' : 'bearish';
    
    // Build the prompt
    const prompt = `
Generate a concise, informative, and professional financial news article about the following stocks in the ${category} sector. 
The market sentiment is currently ${trendDescription}.

STOCKS:
${stocksInfo}

Instructions:
1. Create a compelling, realistic headline that captures market dynamics
2. Write a 4-5 paragraph article that sounds like professional financial journalism
3. Include specific details about the stocks listed, their price movements, and possible reasons
4. Avoid using the exact percentage changes provided, instead describe the movements contextually
5. Do not mention any AI generation or that this is generated content
6. Format the response as a valid JSON object with "title" and "content" fields
7. Ensure the content is factual-sounding but not claiming specific forward-looking predictions

Response Format:
{"title": "Headline Here", "content": "Full article text here..."}
`;

    // Call the AI model to generate the content
    // Using config.deepseekKey but could be modified to use any appropriate AI system
    let generatedContent;
    
    if (config.deepseekKey) {
      // Use DeepSeek API
      try {
        const response = await axios.post('https://api.deepseek.com/v1/chat/completions', {
          model: "deepseek-chat",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.7,
          max_tokens: 1000
        }, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.deepseekKey}`
          }
        });
        
        // Extract the content string and parse as JSON
        const contentString = response.data.choices[0].message.content.trim();
        generatedContent = JSON.parse(contentString);
      } catch (aiError) {
        console.error("Error generating content with DeepSeek:", aiError);
        throw new Error("Failed to generate content with DeepSeek");
      }
    } else {
      // Fallback to a simple template if no AI API is available
      console.log("No DeepSeek API key available, using fallback template generation");
      
      const mainStock = stocks[0];
      const secondaryStock = stocks.length > 1 ? stocks[1] : null;
      
      const title = `${category} Sector ${mainStock.change > 0 ? 'Rises' : 'Dips'} as ${mainStock.name} ${mainStock.change > 0 ? 'Leads' : 'Struggles'} in ${trendDescription.toUpperCase()} Market`;
      
      let content = `In a ${trendDescription} trading session for the ${category} sector, ${mainStock.name} (${mainStock.symbol}) ${mainStock.change > 0 ? 'climbed' : 'fell'} to $${mainStock.price}`;
      
      if (secondaryStock) {
        content += `, while ${secondaryStock.name} (${secondaryStock.symbol}) ${secondaryStock.change > 0 ? 'gained' : 'lost'} ground at $${secondaryStock.price}.\n\n`;
      } else {
        content += `.\n\n`;
      }
      
      content += `Market analysts attribute the ${trendDescription} movement to changing investor sentiment and broader economic factors affecting the ${category} industry. Trading volume for ${mainStock.symbol} reached ${(mainStock.volume/1000000).toFixed(1)} million shares.\n\n`;
      
      content += `"The ${category} sector continues to face ${marketTrend > 0 ? 'opportunities' : 'challenges'} as companies adapt to evolving market conditions," said a senior market analyst. "Investors should monitor these developments closely."\n\n`;
      
      content += `As the market prepares for upcoming earnings reports, the outlook for ${category} stocks remains ${marketTrend > 0 ? 'cautiously optimistic' : 'uncertain'} with potential volatility expected in the coming sessions.`;
      
      generatedContent = { title, content };
    }
    
    // Return the generated news content
    return {
      title: generatedContent.title.trim(),
      content: generatedContent.content.trim()
    };
  } catch (error) {
    console.error("Error in generateNewsContent:", error);
    throw error;
  }
}
