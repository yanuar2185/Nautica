import { connect } from "cloudflare:sockets";

// Variables
const rootDomain = "yanuar.workers.dev";
const serviceName = "v2ray";
const apiKey = "94e4dcf0445ad6e07ead9fe2a9a22cbacbd5a";
const apiEmail = "ardian.syahputra9655@gmail.com";
const accountID = "c12b5f590beadb64de8deea11b498b41";
const zoneID = "06b5cd94022334aea5ee19a72c3cd845";

// Constants
const APP_DOMAIN = `${serviceName}.${rootDomain}`;
const PORTS = [443, 80];
const PROTOCOLS = ["trojan", "vless", "ss"];
const KV_PROXY_URL = "https://raw.githubusercontent.com/mrsyd-my/proxycf/refs/heads/main/kvProxyList.json";
const PROXY_BANK_URL = "https://raw.githubusercontent.com/mrsyd-my/proxycf/refs/heads/main/ProxyList.txt";
const DNS_SERVER_ADDRESS = "8.8.8.8";
const DNS_SERVER_PORT = 53;
const PROXY_HEALTH_CHECK_API = "https://id1.foolvpn.me/api/v1/check";
const CONVERTER_URL = "https://api.foolvpn.me/convert";
const DONATE_LINK = "https://suryd.biz.id";
const PROXY_PER_PAGE = 24;
const WS_READY_STATE_OPEN = 1;
const WS_READY_STATE_CLOSING = 2;
const CORS_HEADER_OPTIONS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
  "Access-Control-Max-Age": "86400",
};
const DEFAULT_ACCOUNT_DAYS = 30;
const PROXY_CACHE_DURATION = 300000; // 5 menit

// Cache untuk proxy list
let cachedProxyList = [];
let lastProxyFetchTime = 0;
let isApiReady = false;

// Account management - Simpan di memory (temporary)
let accountsStorage = [];

// Helper functions
const reverse = s => s.split("").reverse().join("");
const getFlagEmoji = isoCode => String.fromCodePoint(...isoCode.toUpperCase().split("").map(char => 127397 + char.charCodeAt(0)));

// Cached proxy list fetching dengan filter ID dan SG
async function getProxyList(proxyBankUrl = PROXY_BANK_URL) {
  const now = Date.now();
  
  // Gunakan cache jika masih valid
  if (cachedProxyList.length > 0 && now - lastProxyFetchTime < PROXY_CACHE_DURATION) {
    return cachedProxyList;
  }

  try {
    const proxyBank = await fetch(proxyBankUrl);
    if (proxyBank.status === 200) {
      const text = await proxyBank.text();
      const proxyString = text.split("\n").filter(Boolean);
      
      cachedProxyList = proxyString
        .map((entry) => {
          const [proxyIP, proxyPort, country, org] = entry.split(",");
          return {
            proxyIP: proxyIP || "Unknown",
            proxyPort: proxyPort || "Unknown",
            country: country || "Unknown",
            org: org || "Unknown Org",
          };
        })
        // Hanya filter proxy dari Indonesia (ID) dan Singapore (SG)
        .filter(proxy => proxy.country === "ID" || proxy.country === "SG");
      
      lastProxyFetchTime = now;
    }
  } catch (error) {
    console.error("Error fetching proxy list:", error);
  }

  return cachedProxyList;
}

async function getKVProxyList(kvProxyUrl = KV_PROXY_URL) {
  try {
    const kvProxy = await fetch(kvProxyUrl);
    if (kvProxy.status === 200) {
      return await kvProxy.json();
    }
    return {};
  } catch (error) {
    console.error("Error fetching KV proxy list:", error);
    return {};
  }
}

async function reverseProxy(request, target, targetPath) {
  try {
    const targetUrl = new URL(request.url);
    const targetChunk = target.split(":");

    targetUrl.hostname = targetChunk[0];
    targetUrl.port = targetChunk[1]?.toString() || "443";
    targetUrl.pathname = targetPath || targetUrl.pathname;

    const modifiedRequest = new Request(targetUrl, request);
    modifiedRequest.headers.set("X-Forwarded-Host", request.headers.get("Host"));

    const response = await fetch(modifiedRequest);
    const newResponse = new Response(response.body, response);
    
    for (const [key, value] of Object.entries(CORS_HEADER_OPTIONS)) {
      newResponse.headers.set(key, value);
    }
    newResponse.headers.set("X-Proxied-By", "Cloudflare Worker");

    return newResponse;
  } catch (error) {
    console.error("Reverse proxy error:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}

function getAllConfig(request, hostName, proxyList, page = 0) {
  try {
    const uuid = crypto.randomUUID();
    const startIndex = PROXY_PER_PAGE * page;

    // Build document
    const document = new Document(request);
    document.setTitle("Welcome to <span class='text-blue-500 font-semibold'>netopen.web.id Proxy List</span>");
    document.addInfo(`Total: ${proxyList.length}`);
    document.addInfo(`Page: ${page}/${Math.floor(proxyList.length / PROXY_PER_PAGE)}`);

    for (let i = startIndex; i < startIndex + PROXY_PER_PAGE; i++) {
      const proxy = proxyList[i];
      if (!proxy) break;

      const { proxyIP, proxyPort, country, org } = proxy;

      // Build URI
      const uri = new URL(`${reverse("najort")}://${hostName}`);
      uri.searchParams.set("encryption", "none");
      uri.searchParams.set("type", "ws");
      uri.searchParams.set("host", hostName);
      uri.searchParams.set("path", `/${proxyIP}-${proxyPort}`);

      const proxies = [];
      for (const port of PORTS) {
        uri.port = port.toString();
        uri.hash = `${i + 1} ${getFlagEmoji(country)} ${org} WS ${port == 443 ? "TLS" : "NTLS"} [${serviceName}]`;
        
        for (const protocol of PROTOCOLS) {
          // Special exceptions
          if (protocol === "ss") {
            uri.username = btoa(`none:${uuid}`);
            uri.searchParams.set(
              "plugin",
              `v2ray-plugin${port == 80 ? "" : ";tls"};mux=0;mode=websocket;path=/${proxyIP}-${proxyPort};host=${hostName}`
            );
          } else {
            uri.username = uuid;
            uri.searchParams.delete("plugin");
          }

          uri.protocol = protocol;
          uri.searchParams.set("security", port == 443 ? "tls" : "none");
          uri.searchParams.set("sni", port == 80 && protocol == reverse("sselv") ? "" : hostName);

          // Build VPN URI
          proxies.push(uri.toString());
        }
      }
      
      document.registerProxies({ proxyIP, proxyPort, country, org }, proxies);
    }

    // Build pagination
    document.addPageButton("Prev", `/sub/${page > 0 ? page - 1 : 0}`, page > 0 ? false : true);
    const totalPages = Math.floor(proxyList.length / PROXY_PER_PAGE);
    document.addPageButton("Next", `/sub/${page + 1}`, page < totalPages ? false : true);

    return document.build();
  } catch (error) {
    console.error("Error generating config:", error);
    return `An error occurred while generating the configurations. ${error.message}`;
  }
}

// Account management functions
async function getStoredAccounts() {
  return accountsStorage;
}

async function saveAccount(accountData) {
  try {
    const index = accountsStorage.findIndex(acc => acc.id === accountData.id);
    if (index >= 0) {
      accountsStorage[index] = accountData;
    } else {
      accountsStorage.push(accountData);
    }
    return true;
  } catch (error) {
    console.error("Error saving account:", error);
    return false;
  }
}

async function deleteAccount(accountId) {
  try {
    accountsStorage = accountsStorage.filter(acc => acc.id !== accountId);
    return true;
  } catch (error) {
    console.error("Error deleting account:", error);
    return false;
  }
}

// Handler untuk API manajemen akun
async function handleAccountAPI(request, url) {
  try {
    const path = url.pathname;
    
    // GET /api/v1/accounts - Mendapatkan daftar akun
    if (path === "/api/v1/accounts" && request.method === "GET") {
      const accounts = await getStoredAccounts();
      return new Response(JSON.stringify(accounts), {
        headers: {
          "Content-Type": "application/json",
          ...CORS_HEADER_OPTIONS,
        },
      });
    }
    
    // POST /api/v1/accounts - Menambah akun baru
    if (path === "/api/v1/accounts" && request.method === "POST") {
      try {
        const data = await request.json();
        const newAccount = {
          id: generateAccountId(),
          name: data.name,
          server: data.server,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + (data.days || DEFAULT_ACCOUNT_DAYS) * 24 * 60 * 60 * 1000).toISOString(),
          config: generateAccountConfig(data.server)
        };
        
        const success = await saveAccount(newAccount);
        
        return new Response(JSON.stringify(success ? newAccount : { error: "Gagal menyimpan akun" }), {
          status: success ? 200 : 500,
          headers: {
            "Content-Type": "application/json",
            ...CORS_HEADER_OPTIONS,
          },
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: "Invalid request" }), {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...CORS_HEADER_OPTIONS,
          },
        });
      }
    }
    
    // DELETE /api/v1/accounts/:id - Menghapus akun
    const accountIdMatch = path.match(/^\/api\/v1\/accounts\/([^/]+)$/);
    if (accountIdMatch && request.method === "DELETE") {
      const accountId = accountIdMatch[1];
      const success = await deleteAccount(accountId);
      
      return new Response(JSON.stringify({ success }), {
        status: success ? 200 : 500,
        headers: {
          "Content-Type": "application/json",
          ...CORS_HEADER_OPTIONS,
        },
      });
    }
    
    // POST /api/v1/accounts/:id/use - Menggunakan akun tertentu
    if (accountIdMatch && path.endsWith("/use") && request.method === "POST") {
      const accountId = accountIdMatch[1];
      const accounts = await getStoredAccounts();
      const account = accounts.find(acc => acc.id === accountId);
      
      if (account) {
        // Simpan akun yang sedang aktif (dalam memory)
        // Catatan: Ini hanya bersifat sementara selama worker tetap berjalan
        accountsStorage.forEach(acc => acc.active = false);
        account.active = true;
        
        return new Response(JSON.stringify({ success: true }), {
          headers: {
            "Content-Type": "application/json",
            ...CORS_HEADER_OPTIONS,
          },
        });
      } else {
        return new Response(JSON.stringify({ error: "Account not found" }), {
          status: 404,
          headers: {
            "Content-Type": "application/json",
            ...CORS_HEADER_OPTIONS,
          },
        });
      }
    }
    
    // Endpoint tidak ditemukan
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: {
        "Content-Type": "application/json",
        ...CORS_HEADER_OPTIONS,
      },
    });
  } catch (error) {
    console.error("Account API error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        ...CORS_HEADER_OPTIONS,
      },
    });
  }
}

// Fungsi pembantu untuk manajemen akun
function generateAccountId() {
  return 'acc_' + Math.random().toString(36).substr(2, 9);
}

function generateAccountConfig(server) {
  const protocols = ["vless", "trojan", "vmess"];
  const selectedProtocol = protocols[Math.floor(Math.random() * protocols.length)];
  
  return {
    protocol: selectedProtocol,
    server: server,
    port: Math.floor(Math.random() * 20000) + 10000,
  };
}

// Base HTML template
const baseHTML = `<!DOCTYPE html>
<html lang="en" id="html" class="scroll-auto scrollbar-hide dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Proxy List</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
      .scrollbar-hide::-webkit-scrollbar { display: none; }
      .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
    </style>
    <script type="text/javascript" src="https://cdn.jsdelivr.net/npm/lozad/dist/lozad.min.js"></script>
    <script>
      tailwind.config = { darkMode: 'selector' }
    </script>
  </head>
  <body class="bg-white dark:bg-neutral-800 bg-fixed">
    <!-- Notification -->
    <div id="notification-badge" class="fixed z-50 opacity-0 transition-opacity ease-in-out duration-300 mt-9 mr-6 right-0 p-3 max-w-sm bg-white rounded-xl border border-2 border-neutral-800 flex items-center gap-x-4">
      <div class="shrink-0">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#171717" class="size-6">
          <path d="M5.85 3.5a.75.75 0 0 0-1.117-1 9.719 9.719 0 0 0-2.348 4.876.75.75 0 0 0 1.479.248A8.219 8.219 0 0 1 5.85 3.5ZM19.267 2.5a.75.75 0 1 0-1.118 1 8.22 8.22 0 0 1 1.987 4.124.75.75 0 0 0 1.48-.248A9.72 9.72 0 0 0 19.266 2.5Z" />
          <path fill-rule="evenodd" d="M12 2.25A6.75 6.75 0 0 0 5.25 9v.75a8.217 8.217 0 0 1-2.119 5.52.75.75 0 0 0 .298 1.206c1.544.57 3.16.99 4.831 1.243a3.75 3.75 0 1 0 7.48 0 24.583 24.583 0 0 0 4.83-1.244.75.75 0 0 0 .298-1.205 8.217 8.217 0 0 1-2.118-5.52V9A6.75 6.75 0 0 0 12 2.25ZM9.75 18c0-.034 0-.067.002-.1a25.05 25.05 0 0 0 4.496 0l.002.1a2.25 2.25 0 1 1-4.5 0Z" clip-rule="evenodd" />
        </svg>
      </div>
      <div>
        <div class="text-md font-bold text-blue-500">Berhasil!</div>
        <p class="text-sm text-neutral-800">Akun berhasil disalin</p>
      </div>
    </div>

    <!-- Select Country -->
    <div>
      <div class="h-full fixed top-0 w-14 bg-white dark:bg-neutral-800 border-r-2 border-neutral-800 dark:border-white z-20 overflow-y-scroll scrollbar-hide">
        <div class="text-2xl flex flex-col items-center h-full gap-2">
          PLACEHOLDER_BENDERA_NEGARA
        </div>
      </div>
    </div>

    <!-- Main -->
    <div id="container-header">
      <div id="container-info" class="bg-amber-400 border-2 border-neutral-800 text-right px-5">
        <div class="flex justify-end gap-3 text-sm">
          <p id="container-info-ip">IP: 127.0.0.1</p>
          <p id="container-info-country">Country: Indonesia</p>
          <p id="container-info-isp">ISP: Localhost</p>
        </div>
      </div>
    </div>
    
    <div class="container">
      <div id="container-title" class="sticky bg-white dark:bg-neutral-800 border-b-2 border-neutral-800 dark:border-white z-10 py-6 w-screen">
        <h1 class="text-xl text-center text-neutral-800 dark:text-white">
          PLACEHOLDER_JUDUL
        </h1>
      </div>
      
      <div class="flex gap-6 pt-10 w-screen justify-center">
        PLACEHOLDER_PROXY_GROUP
      </div>

      <!-- Pagination -->
      <nav id="container-pagination" class="w-screen mt-8 sticky bottom-0 right-0 left-0 transition -translate-y-6 z-20">
        <ul class="flex justify-center space-x-4">
          PLACEHOLDER_PAGE_BUTTON
        </ul>
      </nav>
    </div>

    <!-- Account Management Windows -->
    <div id="account-management" class="fixed z-30 top-0 left-0 w-full h-full bg-black bg-opacity-50 flex justify-center items-center hidden">
      <div class="bg-white dark:bg-neutral-800 rounded-lg p-6 w-11/12 max-w-md">
        <h2 class="text-xl font-bold mb-4 dark:text-white">Account Management</h2>
        <div id="account-list" class="max-h-60 overflow-y-auto mb-4">
          <!-- Daftar akun akan dimuat di sini -->
        </div>
        <div class="flex justify-between">
          <button onclick="hideAccountManagement()" class="bg-gray-300 dark:bg-neutral-600 text-black dark:text-white px-4 py-2 rounded">Tutup</button>
          <button onclick="showAddAccountForm()" class="bg-blue-500 text-white px-4 py-2 rounded">Tambah Akun</button>
        </div>
      </div>
    </div>

    <div id="add-account-form" class="fixed z-40 top-0 left-0 w-full h-full bg-black bg-opacity-50 flex justify-center items-center hidden">
      <div class="bg-white dark:bg-neutral-800 rounded-lg p-6 w-11/12 max-w-md">
        <h2 class="text-xl font-bold mb-4 dark:text-white">Tambah Akun Baru</h2>
        <div class="mb-4">
          <label class="block text-sm font-medium mb-1 dark:text-white">Nama Akun</label>
          <input type="text" id="account-name" class="w-full p-2 border rounded dark:bg-neutral-700 dark:text-white">
        </div>
        <div class="mb-4">
          <label class="block text-sm font-medium mb-1 dark:text-white">Server</label>
          <select id="account-server" class="w-full p-2 border rounded dark:bg-neutral-700 dark:text-white">
            <option value="SG">Singapore</option>
            <option value="ID">Indonesia</option>
          </select>
        </div>
        <div class="flex justify-between">
          <button onclick="hideAddAccountForm()" class="bg-gray-300 dark:bg-neutral-600 text-black dark:text-white px-4 py-2 rounded">Batal</button>
          <button onclick="addNewAccount()" class="bg-green-500 text-white px-4 py-2 rounded">Simpan</button>
        </div>
      </div>
    </div>

    <footer>
      <div class="fixed bottom-3 right-3 flex flex-col gap-1 z-50">
        <a href="${DONATE_LINK}" target="_blank">
          <button class="bg-green-500 rounded-full border-2 border-neutral-800 p-1 block">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-6">
              <path d="M10.464 8.746c.227-.18.497-.311.786-.394v2.795a2.252 2.252 0 0 1-.786-.393c-.394-.313-.546-.681-.546-1.004 0-.323.152-.691.546-1.004ZM12.75 15.662v-2.824c.347.085.664.228.921.421.427.32.579.686.579.991 0 .305-.152.671-.579.991a2.534 2.534 0 0 1-.921.42Z" />
              <path fill-rule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25ZM12.75 6a.75.75 0 0 0-1.5 0v.816a3.836 3.836 0 0 0-1.72.756c-.712.566-1.112 1.35-1.112 2.178 0 .829.4 1.612 1.113 2.178.502.4 1.102.647 1.719.756v2.978a2.536 2.536 0 0 1-.921-.421l-.879-.66a.75.75 0 0 0-.9 1.2l.879.66c.533.4 1.169.645 1.821.75V18a.75.75 0 0 0 1.5 0v-.81a4.124 4.124 0 0 0 1.821-.749c.745-.559 1.179-1.344 1.179-2.191 0-.847-.434-1.632-1.179-2.191a4.122 4.122 0 0 0-1.821-.75V8.354c.29.082.559.213.786.393l.415.33a.75.75 0 0 0 .933-1.175l-.415-.33a3.836 3.836 0 0 0-1.719-.755V6Z" clip-rule="evenodd" />
            </svg>
          </button>
        </a>
        
        <!-- Account Management Button -->
        <button onclick="showAccountManagement()" class="bg-purple-500 rounded-full border-2 border-neutral-800 p-1">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-6">
            <path fill-rule="evenodd" d="M7.5 6a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM3.751 20.105a8.25 8.25 0 0116.498 0 .75.75 0 01-.437.695A18.683 18.683 0 0112 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 01-.437-.695z" clip-rule="evenodd" />
          </svg>
        </button>

        <button onclick="toggleDarkMode()" class="bg-amber-400 rounded-full border-2 border-neutral-800 p-1">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
          </svg>
        </button>
      </div>
    </footer>

    <script>
      // Shared
      const rootDomain = "${serviceName}.${rootDomain}";
      const notification = document.getElementById("notification-badge");
      const accountManagement = document.getElementById("account-management");
      const addAccountForm = document.getElementById("add-account-form");
      const accountList = document.getElementById("account-list");
      const DEFAULT_ACCOUNT_DAYS = ${DEFAULT_ACCOUNT_DAYS};

      // Account Management Functions
      let currentAccounts = [];

      async function loadAccounts() {
        try {
          const response = await fetch('/api/v1/accounts');
          if (response.ok) {
            currentAccounts = await response.json();
            renderAccounts();
          } else {
            console.error('Failed to load accounts:', response.status);
          }
        } catch (error) {
          console.error('Error loading accounts:', error);
        }
      }

      function renderAccounts() {
        accountList.innerHTML = '';

        if (currentAccounts.length === 0) {
          accountList.innerHTML = '<p class="text-center dark:text-white">Belum ada akun</p>';
          return;
        }

        currentAccounts.forEach(account => {
          const accountElement = document.createElement('div');
          accountElement.className = 'flex justify-between items-center p-2 border-b dark:border-neutral-600';
          accountElement.innerHTML = \`
            <div>
              <h3 class="font-medium dark:text-white">\${account.name}</h3>
              <p class="text-sm text-gray-500 dark:text-gray-400">Server: \${account.server} | Dibuat: \${new Date(account.createdAt).toLocaleDateString()}</p>
            </div>
            <div class="flex space-x-2">
              <button onclick="useAccount('\${account.id}')" class="text-blue-500 hover:text-blue-700">Gunakan</button>
              <button onclick="deleteAccount('\${account.id}')" class="text-red-500 hover:text-red-700">Hapus</button>
            </div>
          \`;
          accountList.appendChild(accountElement);
        });
      }

      function showAccountManagement() {
        accountManagement.classList.remove('hidden');
        loadAccounts();
      }

      function hideAccountManagement() {
        accountManagement.classList.add('hidden');
      }

      function showAddAccountForm() {
        addAccountForm.classList.remove('hidden');
      }

      function hideAddAccountForm() {
        addAccountForm.classList.add('hidden');
      }

      async function addNewAccount() {
        const name = document.getElementById('account-name').value;
        const server = document.getElementById('account-server').value;

        if (!name) {
          alert('Nama akun harus diisi');
          return;
        }

        try {
          const response = await fetch('/api/v1/accounts', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              name,
              server,
              days: DEFAULT_ACCOUNT_DAYS
            })
          });

          if (response.ok) {
            hideAddAccountForm();
            loadAccounts();
            document.getElementById('account-name').value = '';
          } else {
            alert('Gagal menambah akun');
          }
        } catch (error) {
          console.error('Error adding account:', error);
          alert('Terjadi kesalahan saat menambah akun');
        }
      }

      async function useAccount(accountId) {
        try {
          const response = await fetch(\`/api/v1/accounts/\${accountId}/use\`, {
            method: 'POST'
          });

          if (response.ok) {
            alert('Akun berhasil dipilih');
            hideAccountManagement();
            // Refresh halaman untuk menerapkan akun baru
            window.location.reload();
          } else {
            alert('Gagal menggunakan akun');
          }
        } catch (error) {
          console.error('Error using account:', error);
          alert('Terjadi kesalahan saat menggunakan akun');
        }
      }

      async function deleteAccount(accountId) {
        if (!confirm('Apakah Anda yakin ingin menghapus akun ini?')) {
          return;
        }

        try {
          const response = await fetch(\`/api/v1/accounts/\${accountId}\`, {
            method: 'DELETE'
          });

          if (response.ok) {
            loadAccounts();
          } else {
            alert('Gagal menghapus akun');
          }
        } catch (error) {
          console.error('Error deleting account:', error);
          alert('Terjadi kesalahan saat menghapus akun');
        }
      }

      // Existing functions
      function copyToClipboard(text) {
        navigator.clipboard.writeText(text);
        notification.classList.remove("opacity-0");
        setTimeout(() => {
          notification.classList.add("opacity-0");
        }, 2000);
      }

      function toggleDarkMode() {
        const rootElement = document.getElementById("html");
        if (rootElement.classList.contains("dark")) {
          rootElement.classList.remove("dark");
        } else {
          rootElement.classList.add("dark");
        }
      }

      function checkGeoip() {
        const containerIP = document.getElementById("container-info-ip");
        const containerCountry = document.getElementById("container-info-country");
        const containerISP = document.getElementById("container-info-isp");
        
        fetch("https://" + rootDomain + "/api/v1/myip")
          .then(async (res) => {
            if (res.status == 200) {
              const respJson = await res.json();
              containerIP.innerText = "IP: " + (respJson.ip || "Unknown");
              containerCountry.innerText = "Country: " + (respJson.country || "Unknown");
              containerISP.innerText = "ISP: " + (respJson.asOrganization || "Unknown");
            }
          })
          .catch(error => {
            console.error("GeoIP check error:", error);
          });
      }

      window.onload = () => {
        checkGeoip();
      };
    </script>
  </body>
</html>`;

// HTML Document Class
class Document {
  proxies = [];

  constructor(request) {
    this.html = baseHTML;
    this.request = request;
    this.url = new URL(this.request.url);
  }

  setTitle(title) {
    this.html = this.html.replaceAll("PLACEHOLDER_JUDUL", title);
  }

  addInfo(text) {
    const infoElement = `<div class="info-item">${text}</div>`;
    if (this.html.includes("PLACEHOLDER_INFO")) {
      this.html = this.html.replace("PLACEHOLDER_INFO", `${infoElement}\nPLACEHOLDER_INFO`);
    } else {
      // Tambahkan placeholder jika belum ada
      this.html = this.html.replace("</h1>", `</h1>\n<div id="container-info">${infoElement}</div>`);
    }
  }

  registerProxies(data, proxies) {
    this.proxies.push({
      ...data,
      list: proxies,
    });
  }

  buildProxyGroup() {
    let proxyGroupElement = "";
    proxyGroupElement += `<div class="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6">`;
    
    for (let i = 0; i < this.proxies.length; i++) {
      const proxyData = this.proxies[i];

      // Assign proxies
      proxyGroupElement += `<div class="lozad scale-95 mb-2 bg-white dark:bg-neutral-800 transition-transform duration-200 rounded-lg p-4 w-60 border-2 border-neutral-800">`;
      proxyGroupElement += `  <div id="countryFlag" class="absolute -translate-y-9 -translate-x-2 border-2 border-neutral-800 rounded-full overflow-hidden"><img width="32" src="https://hatscripts.github.io/circle-flags/flags/${proxyData.country.toLowerCase()}.svg" /></div>`;
      proxyGroupElement += `  <div>`;
      proxyGroupElement += `    <div id="ping-${i}" class="animate-pulse text-xs font-semibold dark:text-white">Idle ${proxyData.proxyIP}:${proxyData.proxyPort}</div>`;
      proxyGroupElement += `  </div>`;
      proxyGroupElement += `  <div class="rounded py-1 px-2 bg-amber-400 dark:bg-neutral-800 dark:border-2 dark:border-amber-400">`;
      proxyGroupElement += `    <h5 class="font-bold text-md text-neutral-900 dark:text-white mb-1 overflow-x-scroll scrollbar-hide text-nowrap">${proxyData.org}</h5>`;
      proxyGroupElement += `    <div class="text-neutral-900 dark:text-white text-sm">`;
      proxyGroupElement += `      <p>IP: ${proxyData.proxyIP}</p>`;
      proxyGroupElement += `      <p>Port: ${proxyData.proxyPort}</p>`;
      proxyGroupElement += `      <div id="container-region-check-${i}">`;
      proxyGroupElement += `        <input id="config-sample-${i}" class="hidden" type="text" value="${proxyData.list[0] || ''}">`;
      proxyGroupElement += `      </div>`;
      proxyGroupElement += `    </div>`;
      proxyGroupElement += `  </div>`;
      proxyGroupElement += `  <div class="flex flex-col gap-2 mt-3 text-sm">`;
      
      const indexName = [
        `${reverse("NAJORT")} TLS`,
        `${reverse("SSELV")} TLS`,
        `${reverse("SS")} TLS`,
        `${reverse("NAJORT")} NTLS`,
        `${reverse("SSELV")} NTLS`,
        `${reverse("SS")} NTLS`,
      ];
      
      for (let x = 0; x < proxyData.list.length; x++) {
        const proxy = proxyData.list[x];

        if (x % 2 == 0) {
          proxyGroupElement += `<div class="flex gap-2 justify-around w-full">`;
        }

        proxyGroupElement += `<button class="bg-blue-500 dark:bg-neutral-800 dark:border-2 dark:border-blue-500 rounded p-1 w-full text-white" onclick="copyToClipboard('${proxy}')">${indexName[x] || 'Config'}</button>`;

        if (x % 2 == 1 || x === proxyData.list.length - 1) {
          proxyGroupElement += `</div>`;
        }
      }
      
      proxyGroupElement += `  </div>`;
      proxyGroupElement += `</div>`;
    }
    
    proxyGroupElement += `</div>`;
    this.html = this.html.replace("PLACEHOLDER_PROXY_GROUP", proxyGroupElement);
  }

  buildCountryFlag() {
    const proxyBankUrl = this.url.searchParams.get("proxy-list");
    const flagList = [];
    
    for (const proxy of cachedProxyList) {
      if (proxy.country) flagList.push(proxy.country);
    }

    let flagElement = "";
    const uniqueFlags = [...new Set(flagList)];
    
    for (const flag of uniqueFlags) {
      flagElement += `<a href="/sub?cc=${flag}${proxyBankUrl ? "&proxy-list=" + proxyBankUrl : ""}" class="py-1" ><img width=20 src="https://hatscripts.github.io/circle-flags/flags/${flag.toLowerCase()}.svg" /></a>`;
    }

    this.html = this.html.replace("PLACEHOLDER_BENDERA_NEGARA", flagElement);
  }

  addPageButton(text, link, isDisabled) {
    const pageButton = `<li><button ${isDisabled ? "disabled" : ""} class="px-3 py-1 bg-amber-400 border-2 border-neutral-800 rounded" onclick="location.href='${link}'">${text}</button></li>`;
    
    if (this.html.includes("PLACEHOLDER_PAGE_BUTTON")) {
      this.html = this.html.replace("PLACEHOLDER_PAGE_BUTTON", `${pageButton}\nPLACEHOLDER_PAGE_BUTTON`);
    } else {
      this.html = this.html.replace("PLACEHOLDER_PAGE_BUTTON", pageButton);
    }
  }

  build() {
    this.buildProxyGroup();
    this.buildCountryFlag();
    
    // Bersihkan placeholder yang tidak terpakai
    this.html = this.html.replace(/PLACEHOLDER_\w+/gim, "");
    
    return this.html;
  }
}

// Main worker function
export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const upgradeHeader = request.headers.get("Upgrade");

      // Gateway check
      if (apiKey && apiEmail && accountID && zoneID) {
        isApiReady = true;
      }

      // Handle WebSocket connections
      if (upgradeHeader === "websocket") {
        // Untuk sementara kita return response error karena websocket handler kompleks
        return new Response("WebSocket support not implemented", { 
          status: 501,
          headers: { ...CORS_HEADER_OPTIONS }
        });
      }

      // Handle API endpoints
      if (url.pathname.startsWith("/api/v1")) {
        const apiPath = url.pathname.replace("/api/v1", "");
        
        if (apiPath.startsWith("/accounts")) {
          return handleAccountAPI(request, url);
        } else if (apiPath.startsWith("/myip")) {
          return new Response(
            JSON.stringify({
              ip: request.headers.get("cf-connecting-ipv6") ||
                  request.headers.get("cf-connecting-ip") ||
                  request.headers.get("x-real-ip") ||
                  "Unknown",
              colo: request.headers.get("cf-ray")?.split("-")[1] || "Unknown",
              country: request.cf?.country || "Unknown",
              asOrganization: request.cf?.asOrganization || "Unknown"
            }),
            {
              headers: {
                ...CORS_HEADER_OPTIONS,
                "Content-Type": "application/json",
              },
            }
          );
        }
      }

      // Handle subscription requests
      if (url.pathname.startsWith("/sub")) {
        const pageMatch = url.pathname.match(/^\/sub\/(\d+)$/);
        const pageIndex = parseInt(pageMatch ? pageMatch[1] : "0");
        const hostname = request.headers.get("Host");

        // Filter by country if specified
        const countrySelect = url.searchParams.get("cc")?.split(",");
        const proxyBankUrl = url.searchParams.get("proxy-list") || PROXY_BANK_URL;
        
        let proxyList = await getProxyList(proxyBankUrl);
        
        // Apply additional country filter if needed
        if (countrySelect && countrySelect.length > 0) {
          proxyList = proxyList.filter(proxy => countrySelect.includes(proxy.country));
        }

        const result = getAllConfig(request, hostname, proxyList, pageIndex);
        return new Response(result, {
          status: 200,
          headers: { 
            "Content-Type": "text/html;charset=utf-8",
            ...CORS_HEADER_OPTIONS
          },
        });
      }

      // Handle root path
      if (url.pathname === "/") {
        const hostname = request.headers.get("Host");
        let proxyList = await getProxyList(PROXY_BANK_URL);
        const result = getAllConfig(request, hostname, proxyList, 0);
        return new Response(result, {
          status: 200,
          headers: { 
            "Content-Type": "text/html;charset=utf-8",
            ...CORS_HEADER_OPTIONS
          },
        });
      }

      // Default response - reverse proxy
      const targetReverseProxy = "example.com"; // Default target
      return await reverseProxy(request, targetReverseProxy);
      
    } catch (err) {
      console.error("Unhandled error in fetch handler:", err);
      return new Response("Internal Server Error", {
        status: 500,
        headers: {
          ...CORS_HEADER_OPTIONS,
        },
      });
    }
  },
};
