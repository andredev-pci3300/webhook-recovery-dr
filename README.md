# Webhook Recovery Dr

Worker serverless para receber webhooks da Kiwify, aplicar idempotência no Cloudflare KV e sincronizar estados de recuperação de pagamento no ActiveCampaign.

## Arquitetura Geral

Fluxo:

```text
Kiwify -> Cloudflare Worker /webhooks/kiwify -> Cloudflare KV -> ActiveCampaign
```

Componentes:

- `src/index.ts`: roteamento Hono e pipeline HTTP.
- `src/kiwify`: schemas Zod e normalização dos eventos.
- `src/security`: validação por token de webhook da API principal e assinatura Ed25519 da Conta Digital.
- `src/storage`: reserva e marcação de idempotência no KV.
- `src/active-campaign`: cliente HTTP da API v3 do ActiveCampaign.
- `src/recovery`: regras de negócio para tags e custom fields.

## Eventos Suportados

Eventos de venda da API principal Kiwify:

- `pix_gerado`: cria/atualiza contato, aplica tag de cobrança e grava código Pix.
- `boleto_gerado`: cria/atualiza contato, aplica tag de cobrança e grava URL/linha do boleto.
- `compra_aprovada`: remove tag de cobrança e aplica tag de cliente.

Aliases aceitos para interoperabilidade de payloads legados:

- `pix_generated` -> `pix_gerado`
- `billet_printed` -> `boleto_gerado`
- `order_approved` -> `compra_aprovada`

A validação também reconhece envelopes da Conta Digital para `CASHIN.PIX.QRCODES.*` e `CASHOUT.BOLETO.PAYMENTS.*`, seguindo o envelope oficial com `id`, `type`, `version`, `data` e `created_at`.

## Tratamento de Idempotência

A chave de idempotência usa:

```text
kiwify:{source}:{transactionId}:{event}
```

Antes de chamar o ActiveCampaign, o Worker consulta o KV. Se a chave já existir, retorna `200 OK` sem side effects. Para reduzir duplicidade em disparos simultâneos, cria uma chave temporária `:lock` com TTL curto antes do processamento. Ao concluir, grava a chave definitiva por 30 dias e remove o lock.

## Tipagem e Validação

Os payloads são validados com Zod antes da normalização. Para webhooks de venda, o schema exige identificador do pedido, evento, produto e cliente com email válido. Para a Conta Digital, os schemas seguem os tipos oficiais documentados: QR Code criado/pago e boleto com enums de status.

Payload malformado não é enviado ao CRM. Eventos válidos, mas fora do escopo de DR, são respondidos com `200 OK` e `status: ignored`.

## Segurança

Validação suportada:

- API principal Kiwify: token configurado no webhook, comparado com `KIWIFY_WEBHOOK_TOKEN`.
- Conta Digital: headers `x-kiwify-digital-signature` e `x-kiwify-timestamp`, com mensagem `{url_path}:POST:{raw_body}:{timestamp}`, SHA-256 prévio e verificação Ed25519.

## Deploy e Execução Local

Instale dependências:

```bash
npm install
```

Crie `.dev.vars` a partir do exemplo:

```bash
cp .dev.vars.example .dev.vars
```

Variáveis:

```env
KIWIFY_WEBHOOK_TOKEN=token-configurado-no-webhook-kiwify
KIWIFY_WEBHOOK_PUBLIC_KEY_PEM=
ACTIVE_CAMPAIGN_BASE_URL=https://sua-conta.api-us1.com
ACTIVE_CAMPAIGN_API_KEY=chave-activecampaign
ACTIVE_CAMPAIGN_PIX_FIELD_ID=1
ACTIVE_CAMPAIGN_BILLET_FIELD_ID=2
```

Execute localmente:

```bash
npm run dev
```

Teste com mock:

```bash
curl -X POST http://localhost:8787/webhooks/kiwify \
  -H "Content-Type: application/json" \
  --data @docs/mock_payloads/pix_generated.json
```

Crie o KV para produção:

```bash
npx wrangler kv namespace create WEBHOOK_STATE
npx wrangler kv namespace create WEBHOOK_STATE --preview
```

Atualize os IDs em `wrangler.toml` e publique:

```bash
npm run deploy
```
