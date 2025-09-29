const API_BASE_URL = (() => {
  const configured = import.meta.env.VITE_API_BASE_URL;
  if (configured && typeof configured === 'string' && configured.trim().length > 0) {
    return configured.replace(/\/$/, '');
  }

  if (typeof window !== 'undefined') {
    const { hostname, origin } = window.location;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:4000';
    }
    return `${origin.replace(/\/$/, '')}/api`;
  }

  return 'http://localhost:4000';
})();

async function handleResponse(response) {
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let errorMessage = text;
    try {
      const json = JSON.parse(text);
      errorMessage = json?.error || text;
    } catch (_err) {
      // ignore
    }
    const error = new Error(errorMessage || 'Request failed');
    error.status = response.status;
    throw error;
  }
  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return response.json();
  }
  return response.text();
}

export async function fetchConfiguration() {
  const response = await fetch(`${API_BASE_URL}/questions`);
  return handleResponse(response);
}

export async function fetchCustomCategories() {
  const response = await fetch(`${API_BASE_URL}/interview/preferences/categories`);
  const { categories = [] } = await handleResponse(response);
  return categories;
}

export async function createCustomCategory(payload) {
  const response = await fetch(`${API_BASE_URL}/interview/preferences/categories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return handleResponse(response);
}

export async function updateCustomCategory(id, payload) {
  const response = await fetch(`${API_BASE_URL}/interview/preferences/categories/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return handleResponse(response);
}

export async function deleteCustomCategory(id) {
  const response = await fetch(`${API_BASE_URL}/interview/preferences/categories/${id}`, {
    method: 'DELETE'
  });
  if (!response.ok && response.status !== 204) {
    await handleResponse(response);
  }
  return true;
}

export async function uploadResume(file) {
  const formData = new FormData();
  formData.append('resume', file);
  const response = await fetch(`${API_BASE_URL}/interview/resume`, {
    method: 'POST',
    body: formData
  });
  return handleResponse(response);
}

export async function deleteResume(resumeRef) {
  const response = await fetch(`${API_BASE_URL}/interview/resume/${resumeRef}`, {
    method: 'DELETE'
  });
  if (!response.ok && response.status !== 204) {
    await handleResponse(response);
  }
  return true;
}

export async function uploadJobDescription(payload) {
  const response = await fetch(`${API_BASE_URL}/interview/jd`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return handleResponse(response);
}

export async function startInterviewSession(payload) {
  const response = await fetch(`${API_BASE_URL}/interview/start-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return handleResponse(response);
}

export async function fetchInterviewHistory() {
  const response = await fetch(`${API_BASE_URL}/interview/history`);
  return handleResponse(response);
}

export async function fetchInterviewDetail(id) {
  const response = await fetch(`${API_BASE_URL}/interview/history/${id}`);
  return handleResponse(response);
}

export async function saveInterview(payload) {
  const response = await fetch(`${API_BASE_URL}/interview/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return handleResponse(response);
}

export async function summarizeInterview(conversation) {
  const response = await fetch(`${API_BASE_URL}/interview/summary`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversation })
  });
  return handleResponse(response);
}

export async function createRealtimeSession(payload) {
  const response = await fetch(`${API_BASE_URL}/realtime/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return handleResponse(response);
}


