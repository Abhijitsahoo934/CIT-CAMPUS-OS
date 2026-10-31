window.tailwind = window.tailwind || {};
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          fontFamily: {
            sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
          },
          colors: {
            navy: {
              DEFAULT: '#172554',
              800: '#1e3a8a',
              900: '#172554',
              950: '#0f172a',
            },
            brand: {
              indigo: '#6366F1',
              blue: '#3B82F6',
              bg: '#F8FAFC',
              surface: '#FFFFFF',
              text: '#0F172A',
              muted: '#64748B',
              border: '#E2E8F0',
            },
            status: {
              success: '#16A34A',
              warning: '#F59E0B',
              danger: '#DC2626',
              info: '#2563EB',
            }
          }
        }
      }
    };
