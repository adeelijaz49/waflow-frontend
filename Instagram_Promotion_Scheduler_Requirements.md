# Feature: Instagram Promotion Scheduler

## Objective

Build a new WaFlow feature called **Instagram Promotion Scheduler**.

The purpose is to let merchants create, schedule and auto-publish Instagram posts from WaFlow, with every post linked to a trackable WhatsApp promotion.

This feature gives WaFlow both sides of the merchant sales cycle:

1. **New business acquisition**
   - Merchants create Instagram posts and Reels to promote offers, products, services, events and new-customer promotions.
   - Each Instagram post includes a WaFlow-generated WhatsApp link or promotion link.
   - New customers click from Instagram into WhatsApp.

2. **Repeat business and retention**
   - Once the customer enters WhatsApp, WaFlow captures them as a customer profile.
   - WaFlow tracks their conversation, order, booking, payment and loyalty activity.
   - WaFlow can then retarget them with WhatsApp promotions, loyalty reminders, comeback offers and Smart Insights.

This should not be built as a generic social media scheduler.

It should be built as a **social-to-WhatsApp acquisition and retention feature**.

The business value is:

> Instagram brings in new customers. WhatsApp converts and retains them. WaFlow connects both.

---

## Product Positioning

Suggested feature name:
**Instagram Promotion Scheduler**

Alternative names:
- Social-to-WhatsApp Promotions
- Instagram Growth Promotions
- Instagram-to-WhatsApp Promotions

This can be sold as an add-on in future:

**Social Growth Add-On**
- Schedule Instagram posts
- Auto-publish promotions
- Add WhatsApp links
- Track new customers
- Track revenue
- Retarget customers through WhatsApp and loyalty

---

## Core Merchant Use Cases

Merchants should be able to create Instagram promotions such as:

- New customer offer
- First booking discount
- Weekend promotion
- Product launch
- New branch opening
- Quiet time / slow day offer
- Loyalty promotion
- Seasonal promotion
- Ramadan / Eid promotion
- Limited-time offer
- Bring-a-friend promotion
- Referral promotion

Examples:

### Café
Create an Instagram post:
“New to Riyadh Café? Claim your first Spanish Latte offer on WhatsApp.”

CTA:
“Message us on WhatsApp to claim.”

### Salon
Create an Instagram Reel:
“First-time customers get 20% off this week.”

CTA:
“Book through WhatsApp.”

### Gym
Create an Instagram post:
“Try your first class free.”

CTA:
“Message us on WhatsApp to book.”

### Restaurant
Create an Instagram post:
“Weekend family lunch offer.”

CTA:
“Order or reserve by WhatsApp.”

---

## MVP Scope

Focus only on Instagram for now.

Do not build TikTok yet.
Do not build paid ads yet.
Do not build Meta Ads Manager yet.
Do not build Facebook Page posting yet unless it is technically easy and does not delay Instagram.

MVP must include:

- Connect Instagram Professional account
- Create Instagram promotion
- Upload image or video
- Generate Instagram caption using AI
- Generate hashtags using AI
- Generate WhatsApp CTA text
- Generate trackable WhatsApp link
- Add/copy WhatsApp link into caption
- Schedule Instagram post
- Auto-publish Instagram post at scheduled time
- Publish immediately
- Save as draft
- View content calendar
- View post status
- Track clicks from Instagram link
- Attribute new WhatsApp customers to Instagram promotion
- Report WhatsApp conversations, orders, bookings, payments and revenue from Instagram promotions

---

# User Journey

## 1. Connect Instagram

Merchant goes to:

Settings → Social Accounts → Instagram

They click:

**Connect Instagram**

The merchant logs in through Meta/Instagram OAuth and grants WaFlow permission to publish content.

After connection, WaFlow shows:

- Instagram account name
- Instagram handle
- connection status
- permission status
- token expiry where available
- reconnect button
- disconnect button

Connection statuses:

- Not connected
- Connected
- Permission missing
- Token expired
- Account not eligible
- Reconnect required
- Error

---

## 2. Create Instagram Promotion

Merchant goes to:

Promotions → New Promotion → Instagram Promotion

Promotion setup fields:

- Promotion name
- Location/branch
- Promotion goal
- Product/service being promoted
- Offer/discount
- Promotion dates
- Instagram account
- Media upload
- Caption
- Hashtags
- WhatsApp CTA
- Destination action
- Schedule date/time

Promotion goals:

- Get new customers
- Promote product
- Promote service
- Fill quiet slots
- Launch new branch
- Promote loyalty offer
- Promote referral offer
- Drive weekend sales
- Promote seasonal offer

---

## 3. Destination Action

Every Instagram promotion must have a clear conversion destination.

Destination options:

- Start WhatsApp conversation
- Claim offer on WhatsApp
- Book service on WhatsApp
- Order product on WhatsApp
- Join loyalty programme
- Use referral link
- Open WaFlow promotion landing page

For MVP, default destination should be:

**Start WhatsApp conversation**

WaFlow should generate a trackable link that ultimately opens WhatsApp.

Example:

`https://usewaflow.com/t/abc123`

That redirects to:

`https://wa.me/{merchant_whatsapp_number}?text={encoded_promotion_message}`

Example WhatsApp pre-filled message:

“Hi, I’d like to claim the Weekend Coffee Offer. Code: IG-WEEKEND-123”

When the WhatsApp message arrives, WaFlow should detect the promotion code and attribute the customer/conversation to the Instagram promotion.

---

## 4. AI Content Generation

Add AI support inside the Instagram Promotion Builder.

AI should generate:

- Instagram caption
- short caption version
- hashtags
- WhatsApp CTA line
- promotion offer wording
- first comment suggestion, optional
- follow-up WhatsApp message, optional

Example prompts:

- “Create an Instagram caption for a café weekend coffee offer.”
- “Make this more premium.”
- “Make it shorter.”
- “Add Arabic version.”
- “Create a caption for first-time customers.”
- “Create a WhatsApp CTA for this offer.”

Important:
AI-generated content must always be editable.
AI must never publish automatically without user approval.

---

## 5. Schedule or Publish

Merchant can choose:

- Save as draft
- Publish now
- Schedule for later
- Duplicate promotion
- Cancel scheduled post

If scheduled:

- WaFlow stores the post as scheduled.
- Backend worker publishes it at the scheduled time.
- Use merchant/location timezone.
- Log every publish attempt.
- Retry failed publish attempts where appropriate.
- Notify merchant if publishing fails.

Post statuses:

- draft
- scheduled
- publishing
- published
- failed
- cancelled

---

# Instagram / Meta API Technical Requirement

Integrate with Meta / Instagram APIs to allow merchants to connect an Instagram Professional account and publish content from WaFlow.

Instagram publishing requires an Instagram Professional account and, depending on the API/login path, may require the Instagram account to be connected to a Facebook Page. Meta’s Instagram API permission model requires the relevant account/page connection, and content publishing is available to Instagram Professional accounts.

Instagram content publishing uses a two-step publishing flow:

1. Create a media container
2. Publish the media container

The API flow is generally:

- Create media container via `/{ig-user-id}/media`
- Check media container status where required
- Publish via `/{ig-user-id}/media_publish`

This container-based flow is used for publishing media such as photos, videos and Reels.

## Required Meta Setup

WaFlow must have:

- Meta Developer App
- Instagram API product configured
- Valid OAuth redirect URI
- Privacy policy URL
- Terms of service URL
- Data deletion instructions
- App review submission where required
- Required permissions approved

Potential permissions, depending on login route:

- `instagram_basic`
- `instagram_content_publish`
- `pages_show_list`
- `pages_read_engagement`
- `instagram_manage_insights` if insights are required
- or newer Instagram Business Login permissions such as:
  - `instagram_business_basic`
  - `instagram_business_content_publish`

The developer should confirm exact permission set based on the final Meta app setup and selected login flow. Some Meta documentation paths distinguish between Instagram API with Facebook Login and Instagram API with Instagram Login, with different token and permission models.

---

# Supported Instagram Content For MVP

Support:

- Single image feed post
- Single video feed post
- Reel, if supported by selected API route
- Caption
- Hashtags
- WhatsApp link in caption
- Scheduled publishing from WaFlow backend

Do not support in MVP:

- Stories
- Carousels
- Shopping tags
- Product tags
- Collaborator tags
- Paid boosting
- Ads
- DM automation
- Comment management
- Music selection inside Instagram

Reason:
The first objective is acquisition-to-WhatsApp tracking, not full Instagram management.

---

# Instagram Posting Flow

For each post:

1. Confirm Instagram account is connected.
2. Confirm required permissions exist.
3. Validate media file.
4. Store media in WaFlow object storage/CDN.
5. Ensure media URL is publicly accessible over HTTPS if required by Meta API.
6. Create Instagram media container.
7. Poll or check container status where needed.
8. Publish container.
9. Store Instagram provider post ID.
10. Store published timestamp.
11. Mark post as published.
12. If failed, store error code and user-friendly error message.

---

# Scheduling Engine

Build a backend scheduling engine for Instagram posts.

Requirements:

- Store scheduled posts in database.
- Run background worker to check due posts.
- Publish due posts via Instagram API.
- Use merchant timezone.
- Prevent duplicate publishing.
- Support retries.
- Log every attempt.
- Notify merchant on success/failure.
- Show failure reason in UI.

Failure scenarios to handle:

- Token expired
- Permission missing
- Instagram account disconnected
- Media URL inaccessible
- Unsupported media format
- Caption too long
- Meta API error
- Rate limit reached
- Media container failed processing
- Publish failed
- Scheduled time missed

---

# Publishing Limits And Rate Safety

WaFlow should check and respect Instagram publishing limits.

Meta documentation and developer examples reference content publishing limits and recommend enforcing publishing rate limits in scheduling products, especially when users schedule posts in advance.

Add safeguards:

- Do not allow excessive scheduled posts for the same Instagram account.
- Check Instagram content publishing limit endpoint if available.
- Space out posts where necessary.
- Show warning if merchant is close to publish limit.
- Prevent duplicate publish jobs.

---

# Media Handling

WaFlow should support media upload for Instagram posts.

Requirements:

- Upload image
- Upload video
- Generate thumbnail for video
- Validate file type
- Validate file size
- Validate aspect ratio
- Validate video duration
- Validate resolution
- Validate caption length
- Store in S3/object storage/CDN
- Make URL available to Meta API where required
- Reject unsupported media before scheduling

Supported MVP media:

- JPG / PNG for image posts
- MP4 / MOV for video/Reels, depending on API requirements

The developer should validate against current Instagram API media specifications.

---

# Tracking And Attribution

Every Instagram post must generate a unique WaFlow tracking link.

The tracking link should include:

- merchant_id
- promotion_id
- instagram_post_id
- location_id
- source = instagram
- medium = social
- promotion name
- content identifier

Example tracking URL:

`https://usewaflow.com/t/abc123`

This should redirect to the merchant’s WhatsApp deep link:

`https://wa.me/{merchant_number}?text={encoded_promotion_message}`

When the customer sends the WhatsApp message, WaFlow should detect:

- promotion code
- tracking link
- source channel
- Instagram post ID
- merchant
- location
- offer

Then WaFlow should create or update the customer profile and store:

- acquisition_source = instagram
- acquisition_promotion_id
- acquisition_social_post_id
- first_click_at
- first_whatsapp_started_at
- first_order_id, if later
- first_booking_id, if later
- first_payment_id, if later

---

# Reporting

Instagram promotion reporting should show:

- scheduled posts
- published posts
- failed posts
- clicks
- unique clicks
- WhatsApp conversations started
- new customers captured
- orders created
- bookings created
- payments completed
- revenue generated
- loyalty sign-ups
- repeat purchases from acquired customers

Example report:

“Instagram Weekend Coffee Offer generated 72 clicks, 24 WhatsApp conversations, 11 orders and SAR 640 revenue.”

---

# Integration With Existing WaFlow Features

## Promotions

Add Instagram as a promotion channel.

Promotion channels should become:

- WhatsApp
- Instagram
- WhatsApp + Instagram

The merchant should be able to create one promotion and generate both:

- Instagram acquisition post
- WhatsApp follow-up promotion

Example:

Promotion:
Weekend Coffee Offer

Instagram:
Acquire new customers through a public post.

WhatsApp:
Retarget customers who clicked but did not order, or remind customers who ordered to come back next week.

---

## WhatsApp Inbox

When a customer enters through an Instagram tracking link, show this in the inbox:

- Source: Instagram
- Promotion: Weekend Coffee Offer
- First interaction date
- Offer claimed
- Order/payment status
- Loyalty status
- Suggested next action

Example:

“Sarah came from Instagram Weekend Coffee Offer. She claimed the offer but has not paid yet. Send follow-up?”

---

## Loyalty

When an Instagram-acquired customer completes a qualifying action, allow loyalty triggers:

- first purchase reward
- first booking reward
- double points for promotion customers
- join loyalty after first WhatsApp order
- referral reward if linked to referral promotion

---

## Smart Insights

Add Instagram-related insights:

- “Your Instagram post generated 24 WhatsApp conversations this week.”
- “This Instagram promotion created 11 new customers and SAR 640 revenue.”
- “Customers from Instagram have not returned yet. Send a comeback offer?”
- “Your best Instagram acquisition promotion was Weekend Coffee Offer. Run it again?”
- “This post created clicks but few WhatsApp conversations. Try a stronger CTA?”

---

## AI Mode

AI Mode should support:

- “Create an Instagram post for my weekend offer.”
- “Schedule this Instagram promotion for Thursday at 7pm.”
- “Turn this WhatsApp promotion into an Instagram post.”
- “Which Instagram post brought in the most new customers?”
- “Create a follow-up WhatsApp promotion for customers who came from Instagram.”
- “Create a loyalty offer for customers acquired from Instagram.”

AI should prepare drafts, not publish without approval.

---

# Permissions And Roles

Add permissions:

- social_accounts_connect
- instagram_posts_create
- instagram_posts_schedule
- instagram_posts_publish
- instagram_posts_delete
- instagram_analytics_view

Role behaviour:

- Owner/admin can connect Instagram accounts.
- Owner/admin can publish posts.
- Marketing user can create/schedule/publish if permission granted.
- Staff user can view only unless permission granted.

No post should be published without an authorised user action.

---

# Data Model

Suggested tables:

## social_accounts

- id
- merchant_id
- provider: instagram
- provider_account_id
- account_name
- account_handle
- access_token_encrypted
- refresh_token_encrypted nullable
- scopes
- token_expires_at
- status
- connected_by_user_id
- created_at
- updated_at

## instagram_posts

- id
- merchant_id
- promotion_id
- social_account_id
- location_id
- post_type: image / video / reel
- title
- caption
- hashtags
- media_url
- thumbnail_url
- tracking_link_id
- whatsapp_cta_text
- scheduled_at
- published_at
- status: draft / scheduled / publishing / published / failed / cancelled
- provider_post_id
- provider_container_id
- error_code
- error_message
- created_by_user_id
- approved_by_user_id
- created_at
- updated_at

## social_publish_jobs

- id
- instagram_post_id
- merchant_id
- scheduled_at
- status: pending / processing / success / failed / cancelled
- attempts
- last_attempt_at
- next_retry_at
- error_code
- error_message
- created_at
- updated_at

## tracking_links

- id
- merchant_id
- promotion_id
- social_post_id
- source: instagram
- medium: social
- content
- destination_url
- short_url
- clicks
- unique_clicks
- created_at

## tracking_events

- id
- tracking_link_id
- merchant_id
- promotion_id
- social_post_id
- event_type: click / whatsapp_started / customer_created / order_created / booking_created / payment_completed / loyalty_joined
- customer_id nullable
- order_id nullable
- booking_id nullable
- payment_id nullable
- metadata_json
- created_at

---

# UI Requirements

## Settings → Social Accounts

Show:

- Instagram connection card
- connect button
- connected account details
- permissions status
- reconnect button
- disconnect button

## Promotions → New Promotion

Add promotion type:

**Instagram Promotion**

## Promotion Builder Sections

1. Promotion details
2. Instagram account
3. Media upload
4. Caption and hashtags
5. WhatsApp CTA link
6. Schedule/publish
7. Preview
8. Confirmation

## Calendar View

Create a simple content calendar showing:

- drafts
- scheduled posts
- published posts
- failed posts

Allow merchant to click a scheduled post to edit before publish.

---

# Add-On / Entitlement Requirement

This feature should be controlled by plan entitlement or add-on.

Create entitlement:

`instagram_promotion_scheduler_enabled`

If disabled:

- show feature locked state
- explain value
- show upgrade/add-on CTA

If enabled:

- allow connection, scheduling and publishing

---

# Compliance And Merchant Responsibility

Add UI copy:

- Merchant is responsible for ensuring they own or have rights to uploaded content.
- Merchant is responsible for accuracy of offers and claims.
- WaFlow will only publish after merchant approval.
- Instagram/Meta may reject posts because of format, policy, permission or API issues.
- Published posts may be subject to Instagram platform limits and policies.

---

# Acceptance Criteria

- Merchant can connect an Instagram Professional account.
- WaFlow securely stores Instagram account connection and tokens.
- Merchant can create an Instagram promotion.
- Merchant can upload image or video media.
- Merchant can generate/edit caption, hashtags and WhatsApp CTA.
- WaFlow generates a unique trackable WhatsApp link for the Instagram post.
- Merchant can save post as draft.
- Merchant can publish immediately.
- Merchant can schedule post for future auto-publishing.
- Scheduled posts publish automatically at the correct time.
- WaFlow logs publish status and provider post ID.
- WaFlow shows clear failure reasons when publishing fails.
- Customer clicks from Instagram are tracked.
- Customers entering WhatsApp from Instagram are attributed to the promotion.
- Reporting shows clicks, WhatsApp conversations, new customers, bookings, orders, payments and revenue.
- Instagram-acquired customers can later be targeted with WhatsApp promotions and loyalty offers.
- AI-generated content is editable and never published without approval.
- Feature can be enabled/disabled as an add-on.
- Existing WhatsApp promotions, loyalty, inbox, AI Mode, Smart Insights and usage metering must not break.
