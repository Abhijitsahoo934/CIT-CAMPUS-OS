(function () {
  'use strict';

  const demoEmails = {
    admin: 'admin@cit.edu.in',
    department_coordinator: 'coord.cse@cit.edu.in',
    faculty: 'f07@cit.edu.in',
    club: 'club@cit.edu.in'
  };

  function setStatus(message, className) {
    const status = document.getElementById('auth-status');
    if (!status) return;
    status.textContent = message;
    status.className = className;
  }

  function setSupabaseStatus(message, className) {
    const status = document.getElementById('supabase-status');
    if (!status) return;
    status.textContent = message;
    status.className = className;
  }

  function showError(message) {
    const error = document.getElementById('login-error');
    if (!error) return;
    error.textContent = message;
    error.classList.remove('hidden');
  }

  function clearError() {
    const error = document.getElementById('login-error');
    if (!error) return;
    error.textContent = '';
    error.classList.add('hidden');
  }

  async function requestJson(url, options) {
    let response;
    try {
      response = await fetch(url, Object.assign({
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }
      }, options));
    } catch (error) {
      if (error instanceof TypeError) {
        throw new Error('Cannot connect to CampusFlow. Start the server with "node server.js" and open http://127.0.0.1:3000.');
      }
      throw error;
    }
    const rawText = await response.text();
    let body = {};
    try {
      body = rawText ? JSON.parse(rawText) : {};
    } catch {
      if (!response.ok) {
        const error = new Error(rawText || 'Server error (' + response.status + ')');
        error.status = response.status;
        throw error;
      }
    }
    if (!response.ok) {
      const error = new Error(body.error || rawText || 'The request could not be completed.');
      error.status = response.status;
      throw error;
    }
    return body;
  }

  function enterApplication(user) {
    window.CAMPUSFLOW_USER = user;
    document.getElementById('app-shell').classList.remove('hidden');
    document.getElementById('auth-view').classList.add('hidden');
    window.dispatchEvent(new CustomEvent('campusflow:authenticated', { detail: { user: user } }));
  }

  function bindLoginForm() {
    const form = document.getElementById('login-form');
    const submit = document.getElementById('btn-login-submit');
    if (!form) return;

    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      clearError();
      if (!form.reportValidity()) return;
      if (submit) submit.disabled = true;

      const emailInput = document.getElementById('login-email');
      const passwordInput = document.getElementById('login-password');
      const rememberInput = document.getElementById('login-remember');
      try {
        const result = await requestJson('/api/login', {
          method: 'POST',
          body: JSON.stringify({
            email: emailInput.value,
            password: passwordInput.value,
            remember: Boolean(rememberInput && rememberInput.checked)
          })
        });
        passwordInput.value = '';
        enterApplication(result.user);
      } catch (error) {
        showError(error.status === 401 ? 'Email or password is incorrect.' : error.message);
      } finally {
        if (submit) submit.disabled = false;
      }
    });
  }

  function bindDemoAccounts() {
    document.querySelectorAll('.demo-login-btn').forEach(button => {
      button.addEventListener('click', function () {
        const email = demoEmails[this.getAttribute('data-demo-role')];
        if (!email) return;
        document.getElementById('login-email').value = email;
        document.getElementById('login-password').value = '';
        clearError();
        document.getElementById('login-password').focus();
      });
    });
  }

  function bindLoginHelpers() {
    const passwordButton = document.getElementById('btn-toggle-pwd');
    if (passwordButton) {
      passwordButton.addEventListener('click', function () {
        const password = document.getElementById('login-password');
        if (password) password.type = password.type === 'password' ? 'text' : 'password';
      });
    }

    const forgotButton = document.getElementById('btn-forgot-pwd');
    if (forgotButton) {
      forgotButton.addEventListener('click', function () {
        showError('Password reset is not available in this demo. Contact your CIT administrator.');
      });
    }
  }

  async function signOut() {
    clearError();
    try {
      await requestJson('/api/logout', { method: 'POST', body: '{}' });
      window.CAMPUSFLOW_USER = null;
      document.getElementById('app-shell').classList.add('hidden');
      document.getElementById('auth-view').classList.remove('hidden');
      document.getElementById('login-password').value = '';
      document.getElementById('btn-close-login').classList.add('hidden');
      document.getElementById('login-email').focus();
    } catch (error) {
      showError(`Sign out failed: ${error.message}`);
      document.getElementById('auth-view').classList.remove('hidden');
      document.getElementById('btn-close-login').classList.remove('hidden');
    }
  }

  function bindSessionButtons() {
    ['btn-open-login', 'btn-user-menu'].forEach(id => {
      const button = document.getElementById(id);
      if (button) button.addEventListener('click', signOut);
    });

    const closeButton = document.getElementById('btn-close-login');
    if (closeButton) {
      closeButton.addEventListener('click', function () {
        if (window.CAMPUSFLOW_USER) {
          document.getElementById('auth-view').classList.add('hidden');
        }
      });
    }
  }

  async function restoreSession() {
    try {
      const health = await requestJson('/api/health', { method: 'GET', headers: {} });
      setStatus('Connected', 'text-emerald-600');
      setSupabaseStatus(
        health.supabaseConfigured ? 'Configured' : 'Not configured',
        health.supabaseConfigured ? 'text-emerald-600' : 'text-amber-600'
      );
      const result = await requestJson('/api/session', { method: 'GET', headers: {} });
      enterApplication(result.user);
    } catch (error) {
      if (error.status === 401) {
        setStatus('Connected', 'text-emerald-600');
        document.getElementById('auth-view').classList.remove('hidden');
      } else {
        setStatus('Unavailable', 'text-red-600');
        setSupabaseStatus('Unavailable', 'text-red-600');
        showError(error.message);
      }
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    bindLoginForm();
    bindDemoAccounts();
    bindLoginHelpers();
    bindSessionButtons();
    restoreSession();
  });
})();
