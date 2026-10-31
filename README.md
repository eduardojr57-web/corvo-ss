# Corvo SS

Protótipo funcional de compartilhamento de tela com convites, avisos e gravação dos últimos minutos.

## Funcionalidades

- **Admin**: cria sessão (código de 6 caracteres), envia avisos, vê até 4 telas ao vivo, solicita gravação dos últimos 2/5/10 minutos e baixa o arquivo.
- **Transmissor** (máx. 4): entra com o código, vê avisos, compartilha a tela (requer permissão do navegador). Não vê as telas dos outros transmissores.
- **Convidado**: entra com o código e apenas assiste às telas que estão sendo transmitidas + vê os avisos. Sem interação.

A gravação fica em um **buffer circular de 10 minutos** no navegador do transmissor. Quando o admin pede, o arquivo é gerado e enviado automaticamente (ou baixado localmente se o upload falhar).

## Requisitos

- Node.js 18+ 
- Navegador moderno (Chrome, Edge, Firefox, Safari recente)
- HTTPS em produção (obrigatório para `getDisplayMedia` em dispositivos reais – localhost funciona sem HTTPS)

## Como rodar localmente

```bash
cd corvo-ss
npm install
npm start
```

Abra: http://localhost:3000

1. Clique em **Criar sessão** (Admin)
2. Copie o código que aparece
3. Em outra aba/dispositivo: cole o código e escolha **Transmitir tela** ou **Só assistir**

## Deploy online (gratuito)

### Opção rápida – Render.com

1. Crie conta em [render.com](https://render.com)
2. New → Web Service
3. Conecte o repositório (ou faça upload do código)
4. Build command: `npm install`
5. Start command: `npm start`
6. Depois de publicar, o site terá HTTPS automaticamente (necessário para celular)

### Outras opções

- Railway.app
- Fly.io
- Glitch.com (pode colar os arquivos)

## Observações importantes

- Em redes celulares ou NATs restritivos o WebRTC pode precisar de um TURN server melhor. O protótipo usa um TURN público de teste (openrelay) que tem limites.
- A qualidade e a estabilidade melhoram muito com um TURN próprio (ex: Twilio, Metered.ca, ou coturn self-hosted).
- Os arquivos de gravação ficam no servidor por no máximo ~2 horas e depois são apagados.
- Sessões sem atividade são limpas após 6 horas.
- Funciona em celular e PC (Android Chrome e iOS Safari recentes suportam compartilhamento de tela com limitações).

## Estrutura

```
corvo-ss/
├── server.js          # Express + Socket.io + upload de gravações
├── package.json
├── public/
│   ├── index.html     # Tela inicial
│   ├── admin.html
│   ├── transmitter.html
│   ├── viewer.html
│   ├── css/style.css
│   └── js/
│       ├── common.js      # WebRTC helper + RollingRecorder
│       ├── admin.js
│       ├── transmitter.js
│       └── viewer.js
└── uploads/           # gerado automaticamente
```

## Limitações do protótipo

- Máximo 4 transmissores simultâneos (hardcoded)
- Sem autenticação forte (qualquer um com o código entra)
- Buffer de gravação usa MediaRecorder (WebM) – qualidade ~1.5 Mbps
- Em alguns celulares o compartilhamento de tela só mostra a aba do navegador ou tem restrições do sistema

Feito para uso com consentimento explícito dos participantes.
