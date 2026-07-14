const email = 'admin@lms.com';
const password = 'admin123@@90!!90';

async function testLogin() {
  try {
    console.log("Phase 1: Password Auth");
    const phase1Response = await fetch('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    
    const phase1Data = await phase1Response.json();
    console.log("Phase 1 response:", phase1Data);
    
    if (!phase1Data.challengeToken) {
      console.error("No challenge token received.");
      return;
    }

    const { challengeToken, totpSecret } = phase1Data;
    
    console.log("Phase 2: Sending MFA Code with challengeToken");
    
    // Send a dummy code for testing (should give Invalid Authenticator Code if challenge passes)
    const phase2Response = await fetch('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeToken, code: '123456' })
    });

    const phase2Data = await phase2Response.json();
    console.log("Phase 2 response:", phase2Data);
  } catch (err) {
    console.error("Test script error:", err);
  }
}

testLogin();
