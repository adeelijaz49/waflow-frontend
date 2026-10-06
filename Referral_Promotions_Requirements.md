# Feature: Referral Promotions / Refer-a-Friend

## Objective

Build a new WaFlow feature called **Referral Promotions**.

The purpose is to allow merchants to create referral links that can be shared by customers, posted on social media, or sent through WhatsApp, so merchants can acquire new customers and reward the original referrer.

This feature should help merchants drive new business through existing customers.

Example:
A customer receives a referral link from Riyadh Café. They share it with a friend. The friend clicks the link, starts a WhatsApp conversation, places an order or booking, and the original customer receives loyalty points, discount, voucher or reward.

## Core Concept

Each referral link must be uniquely associated with:

- merchant
- promotion
- referrer customer
- referral reward rule
- source/channel where possible

This allows WaFlow to track:

- who shared the link
- who clicked the link
- who became a new customer
- who completed a purchase/booking
- which referrer should be rewarded
- how much reward should be issued

## Example Merchant Use Cases

### Café
“Give your friend 15% off their first order. You get 50 points when they buy.”

### Salon
“Invite a friend. They get 20% off their first booking. You get SAR 25 off your next treatment.”

### Gym
“Refer a friend to join. They get a free trial class. You get 100 loyalty points.”

### Restaurant
“Share this link. Your friend gets a free dessert with their first order. You earn points when they visit.”

### Retail
“Share your referral link. Your friend gets 10% off their first purchase. You get 50 points when they buy.”

## Referral Promotion Types

Allow merchants to create referral promotions with different reward structures.

Supported MVP types:

1. **Give and Get**
   - Friend gets a discount/reward
   - Referrer gets a reward after friend completes qualifying action

2. **Referrer Reward Only**
   - Referrer gets points or discount when friend completes qualifying action

3. **Friend Reward Only**
   - Friend receives offer through referral link
   - No referrer reward

4. **Social Referral Link**
   - Merchant generates generic promotion link for social
   - No specific referrer unless customer-specific link is generated

## Referral Promotion Creation Flow

Merchant should be able to create a referral promotion from the **Promotions** section (New Promotion).

Promotion setup fields:

- Promotion name
- Promotion type: Referral
- Promotion dates
- Eligible locations/branches
- Referrer reward type
- Friend/new customer reward type
- Qualifying action
- Maximum reward per referrer
- Maximum total promotion rewards
- Expiry date
- Terms and conditions

## Reward Types

Supported reward types:

### Referrer reward
- Loyalty points
- Fixed discount amount
- Percentage discount
- Voucher
- Free product/service
- Manual reward approval

### Friend reward
- Fixed discount amount
- Percentage discount
- Voucher
- Free product/service
- First-order reward
- First-booking reward
- Loyalty points on signup or purchase

## Qualifying Actions

The merchant should choose when the referrer earns the reward.

Options:

- Friend clicks the referral link
- Friend starts a WhatsApp conversation
- Friend creates a customer profile
- Friend places first order
- Friend completes payment
- Friend completes booking
- Friend joins loyalty programme
- Friend reaches minimum spend

Recommended default:
**Reward referrer only after friend completes first paid order or booking.**

This prevents abuse and fake referrals.

## Referral Link Types

WaFlow should support two types of links:

### 1. Customer-specific referral link

This link is linked to a specific existing customer/referrer.

Example:
`https://waflow.link/r/abc123`

Behind the scenes it should map to:
- merchant_id
- promotion_id
- referrer_customer_id
- referral_code

Used when:
- merchant sends referral link to customers
- customer shares with friends
- customer views/copies their own referral link

### 2. Generic promotion referral link

This link is linked to the merchant/promotion but not a referrer.

Example:
`https://waflow.link/c/xyz789`

Used when:
- merchant posts on Instagram/TikTok
- merchant shares a QR code
- promotion is for public acquisition
- no referrer reward is needed

## Referral Code / Link Generation

Each referrer should have a unique referral code per promotion.

Suggested structure:

- referral_code
- merchant_id
- promotion_id
- referrer_customer_id
- short_url
- status
- created_at
- expires_at

The referral code should be unique, hard to guess, and not expose customer personal data.

Do not put phone numbers or customer names in the URL.

## Customer Sharing Flow

Merchant can send referral links to customers by WhatsApp.

Example message:

“Hi Ahmed 👋 Share this link with a friend. They’ll get 15% off their first order, and you’ll earn 50 points when they buy: [referral_link]”

Customer can then forward the link to friends or post it socially.

## Friend / New Customer Flow

When a friend clicks a referral link:

1. WaFlow opens a referral landing page or redirects to WhatsApp.
2. WaFlow records the click.
3. WaFlow stores attribution:
   - referral_code
   - referrer_customer_id
   - promotion_id
   - merchant_id
   - source channel if available
4. The friend is directed to WhatsApp with a pre-filled message.
5. When the friend sends the WhatsApp message, WaFlow creates or updates the customer profile.
6. The new customer is linked to the referral.
7. When the qualifying action is completed, the referrer reward is issued.

## WhatsApp Deep Link

Each referral link should generate a WhatsApp deep link with promotion context.

Example prefilled message:
“Hi, I’d like to claim my referral offer.”

The tracking link should redirect to:
`https://wa.me/{merchant_number}?text={encoded_referral_message}`

The message should include a hidden or visible referral code where needed.

Example:
“Hi, I’d like to claim my referral offer. Code: ABC123”

When the message arrives in WaFlow, WaFlow should detect the code and associate the conversation to the referral promotion.

## Attribution Rules

A referral should be attributed when:

- the link is clicked, and/or
- the referral code appears in the WhatsApp message, and/or
- the customer profile is created from the referral landing flow

Attribution should be stored at customer level:

- acquisition_source: referral
- referred_by_customer_id
- referral_promotion_id
- referral_code
- first_referral_click_at
- first_referral_conversion_at

## Duplicate / Abuse Prevention

Build basic fraud prevention.

Rules:

- A customer cannot refer themselves.
- A phone number already known to the merchant should not count as a “new customer” unless merchant allows it.
- A referral should only be rewarded once per referred customer per promotion.
- Referrer reward should only be issued after qualifying action.
- Maximum rewards per referrer should be configurable.
- Maximum total promotion rewards should be configurable.
- Referral links should expire when the promotion ends.
- Merchant should be able to void a referral manually.
- Suspicious referrals should be flagged for review.

Examples of suspicious behaviour:

- same phone number used repeatedly
- same device/IP producing many referrals
- referrer and referred customer have same phone number
- many clicks but no conversions
- unusual volume from one referrer

Do not overbuild fraud detection in MVP, but create the data model so it can be improved later.

## Referral Rewards

When the qualifying action is completed, WaFlow should automatically create the reward transaction.

If reward is loyalty points:
- create loyalty transaction for referrer
- update loyalty balance
- link transaction to referral conversion

If reward is discount/voucher:
- create voucher or discount record
- link it to referrer
- show it in customer profile

If manual approval is enabled:
- mark referral as pending_reward_approval
- merchant/admin can approve or reject reward

## Referral Statuses

Each referral should have a status:

- link_created
- clicked
- whatsapp_started
- customer_created
- qualified
- reward_pending
- reward_issued
- rejected
- expired
- voided

## Merchant Dashboard

Add referral reporting to Promotions and Dashboard.

For each referral promotion, show:

- referral links generated
- links shared
- clicks
- WhatsApp conversations started
- new customers created
- orders/bookings created
- revenue generated
- referrers rewarded
- points issued
- vouchers issued
- top referrers
- conversion rate

Example insight:
“Your referral promotion created 18 new customers and SAR 2,450 revenue. Top referrer: Ahmed, with 5 successful referrals.”

## Customer Profile

In the customer profile, show:

For referrer:
- referral links shared
- successful referrals
- rewards earned
- referral promotion history

For referred customer:
- referred by
- referral promotion
- first purchase/booking
- reward received
- conversion date

## WhatsApp Inbox Integration

Inside the WhatsApp Inbox, show referral context.

Example:

Customer: Sarah  
Source: Referred by Ahmed  
Promotion: Weekend Coffee Referral  
Offer: 15% first order discount  
Status: Reward pending until first payment

For Ahmed:

Customer: Ahmed  
Referral promotion: Weekend Coffee Referral  
Successful referrals: 3  
Points earned: 150

## Smart Insights Integration

Smart Insights should generate referral insights.

Examples:

- “Your referral promotion generated 12 new customers this week. Run it again?”
- “Ahmed referred 5 customers. Send him a VIP reward?”
- “Your referral offer had many clicks but few purchases. Try a stronger friend reward?”
- “Referral customers spent SAR 1,800 this week.”
- “Your top 10 loyal customers could be invited to share referral links.”

## AI Mode Integration

AI Mode should support referral prompts.

Examples:

- “Create a referral promotion for my top customers.”
- “Which customers should I ask for referrals?”
- “Who referred the most customers this month?”
- “Create a message asking loyal customers to share a referral link.”
- “What referral reward should I offer?”
- “Show me referral promotion revenue.”

AI-generated referral messages should always be editable before sending.

## Promotion Builder Integration

Add “Referral Promotion” as a promotion type in the Promotions section.

Promotion channels:

- WhatsApp
- Social
- QR code
- Link
- WhatsApp + Social

The merchant should be able to:
- create referral promotion
- generate customer-specific links
- send links by WhatsApp
- copy generic promotion link
- download QR code
- view performance

## QR Code Support

Each referral promotion should be able to generate QR codes.

QR code types:

1. Generic promotion QR
   - for posters, table tents, receipts, flyers

2. Customer-specific QR
   - for individual referrers if needed

QR scans should be tracked as source:
- qr_code

## Data Model

Suggested tables:

### referral_promotions
- id
- merchant_id
- promotion_id
- name
- description
- starts_at
- ends_at
- status
- friend_reward_type
- friend_reward_value
- referrer_reward_type
- referrer_reward_value
- qualifying_action
- minimum_spend
- max_rewards_per_referrer
- max_total_rewards
- requires_manual_approval
- terms_text
- created_by_user_id
- created_at
- updated_at

### referral_codes
- id
- merchant_id
- referral_promotion_id
- referrer_customer_id nullable
- code
- short_url
- qr_code_url
- status
- created_at
- expires_at

### referral_clicks
- id
- merchant_id
- referral_promotion_id
- referral_code_id
- referrer_customer_id nullable
- source
- medium
- ip_hash
- user_agent_hash
- clicked_at
- metadata_json

### referrals
- id
- merchant_id
- referral_promotion_id
- referral_code_id
- referrer_customer_id nullable
- referred_customer_id nullable
- referred_phone_hash nullable
- status
- attribution_source
- first_click_at
- whatsapp_started_at
- customer_created_at
- qualified_at
- reward_issued_at
- order_id nullable
- booking_id nullable
- payment_id nullable
- revenue_amount
- reward_type
- reward_value
- reward_status
- rejection_reason
- created_at
- updated_at

### referral_rewards
- id
- merchant_id
- referral_id
- referrer_customer_id
- referred_customer_id
- reward_type
- reward_value
- loyalty_transaction_id nullable
- voucher_id nullable
- status
- approved_by_user_id nullable
- issued_at
- created_at

## Privacy / Security

- Do not expose phone numbers or customer names in referral links.
- Use random referral codes, not personal data.
- Hash IP/user agent data if stored for abuse prevention.
- Respect customer opt-out status.
- Do not send promotional referral messages to opted-out customers.
- Do not allow referral rewards for customers who have opted out if this conflicts with programme rules.

## MVP Scope

Must have:

- Create Referral Promotion
- Generate generic promotion referral link
- Generate customer-specific referral links
- Send referral link to selected customers via WhatsApp
- Track referral link clicks
- Redirect to WhatsApp with referral code
- Detect referral code in WhatsApp conversation
- Create/update referred customer profile
- Attribute referred customer to referrer
- Reward referrer after qualifying action
- Support loyalty points as referrer reward
- Support discount/voucher as friend reward
- Referral promotion reporting
- Show referral details in customer profile
- Basic abuse prevention
- Manual reward approval option

Nice to have later:

- Advanced fraud detection
- Tiered referral rewards
- Leaderboards
- Social sharing buttons
- Referral landing pages with branding
- Referral widgets for websites
- POS receipt referral links
- Multi-level referrals
- Automatic best-referrer Smart Insights
- Referral A/B testing

## Acceptance Criteria

- Merchant can create a referral promotion.
- Merchant can define friend reward and referrer reward.
- WaFlow generates unique referral links for selected customers.
- WaFlow can generate a generic referral link for social posting.
- Referral links do not expose personal data.
- Merchant can send referral links to customers through WhatsApp.
- Customer can share the referral link with a friend.
- Friend clicking the link is tracked.
- Friend is redirected to WhatsApp with referral promotion context.
- When the friend starts a WhatsApp conversation, WaFlow associates them with the referral promotion.
- When the friend completes the qualifying action, the referrer receives the configured reward.
- A referrer cannot reward themselves.
- A referred customer can only trigger one reward per promotion.
- Merchant can see referral promotion performance.
- Customer profiles show referral relationships.
- WhatsApp Inbox shows referral source/context.
- Opted-out customers are excluded from promotional referral messages.
- Existing promotions, loyalty, WhatsApp Inbox and Smart Insights must not break.
