# B2C Extension — Proposal

**Project:** RECAI Product Recommendation
**Author:** Mounika Badri
**Branch:** `feature/b2c`
**Status:** For review

---

## 1. What we have today

The current RECAI application is an **internal dashboard for retail planners** — the people inside our business who decide which products should be pushed to which stores. When a planner logs in, they see:

- A **home dashboard** with high-level numbers (sales, top products, etc.).
- A **Store Recommendations** page that suggests which products each store should stock.
- A **Clusters** page that groups stores with similar buying patterns.
- An **Analysis / Forecast** page for future sales predictions.
- A **Chat Assistant** they can ask questions like *"which stores are in cluster 2?"*.

Everything the app knows about is at the **store level**. It answers questions like *"what should store S01001 stock next month?"* — but it has no idea who the individual shoppers walking into that store are.

## 2. What the senior asked for

Add a **B2C angle** — meaning, bring the **end customer / shopper** into the picture — but *without* rebuilding the existing app. Keep everything the planners already use, and add new capabilities alongside.

## 3. What "B2C" means, in two flavors

There are two very different ways to add "B2C" to the app. They lead to very different amounts of work.

| Flavor | In simple words | What it needs |
|---|---|---|
| **A. Customer insights for the planner** | Give the planner a new set of pages that answer *"who are our customers and how do they behave?"* — but only planners see it. No customer ever logs in. | Just customer-behavior data. Ready to build now. |
| **B. A real shopping experience for customers** | Actual end-shoppers log in to the app, browse products, get personalized recommendations, place orders. | A real product catalog (names, images, prices), a proper backend login system, order/cart features. Significantly bigger effort. |

**Recommendation: do Flavor A first.** It's fast, it reuses almost everything we already built, and it delivers immediate value to the planner. Flavor B stays on the roadmap but is *not* part of this proposal.

## 4. The data we'll use

I've already downloaded a public dataset called **UserBehavior** (from Alibaba's Taobao platform, around 100 million rows). For every shopper it records:

- Which product they **viewed**,
- Which product they **added to cart**,
- Which product they **favourited / wishlisted**,
- Which product they **bought**,
- And when each of these happened.

**Honest limitation:** this dataset has no product names, images, or prices — only anonymised IDs. That is perfectly fine for *analysing customer behaviour* (Flavor A), but it is **not** enough to run a real online store (Flavor B). If Flavor B is ever approved, we'd bring in a second dataset (Amazon product reviews) that has full product details.

## 5. What we'll actually add to the app (Flavor A)

Four new areas of value for the planner. Each translates into new pages or panels in the existing app — no separate app, no separate login.

### 5.1 A "Customers" section in the sidebar

Alongside the existing "Stores" area, a new "Customers" area with three pages:

1. **Customer list & search** — planner can search for any shopper and open their profile.
2. **Customer 360 profile** — for a chosen shopper, we show:
   - What categories they browse and buy the most.
   - How often they come back.
   - Where they usually drop off (e.g. they view a lot but rarely buy).
   - Which "type of customer" they are (see next point).
3. **Customer Segments** — we group all shoppers into a handful of easy-to-understand types, for example:
   - *"Frequent buyers"* — come back often, buy often.
   - *"Browsers who rarely convert"* — look a lot, buy little.
   - *"Big-basket occasional shoppers"* — visit rarely, but buy a lot when they do.
   - *"New / one-time shoppers"* — bought once, haven't returned.

   Each segment shows how many people are in it and what they tend to buy.

### 5.2 A "Shopping funnel" view

A simple visualisation showing, for any time period or product category, the customer drop-off:

> **View → Add to cart → Add to wishlist → Buy.**

This tells the planner things like *"in Kids Outerwear, 80% of people who add to cart don't actually buy — we might have a pricing or checkout issue."*

### 5.3 A "Frequently bought together" panel

On the existing Store Recommendations page, we add a small extra tab that shows product pairs commonly bought together (like the *"Customers also bought"* strip on Amazon). This turns individual recommendations into **bundle suggestions**.

### 5.4 A smarter Chat Assistant

The existing chat assistant already answers store and cluster questions. We'll teach it a few new tricks so the planner can ask things like:

- *"Tell me about customer 12345."*
- *"What are the top items for the frequent-buyers segment?"*
- *"What does the shopping funnel look like for Kids Outerwear?"*

## 6. Does it need a separate customer login?

**No.** For everything in this proposal, the planner is the only user, so we keep the current single login exactly as it is. Nothing on the login screen changes.

If Flavor B is approved in the future, we would then add a "role" concept to the same login (planner vs. customer) — but that is a future decision, not part of this proposal.

## 7. How the app will look after the changes

Nothing existing is removed or restructured. The change is purely **additive**:

- The **sidebar** gets grouped into two sections: *Stores (existing)* and *Customers (new)*.
- The **home dashboard** gains a small strip of new tiles (total customers, active this week, buy rate).
- The **Store Recommendations** page gets one extra tab (*"Frequently bought together"*).
- The **Chat Assistant** gains a few new question types.
- Three brand-new pages appear under *Customers* (List, Profile, Segments).

For a planner logging in today and a planner logging in after the change, the experience of using the existing pages is **identical**. They simply have more places to explore.

## 8. Risks and how we handle them

| Risk | In plain words | How we handle it |
|---|---|---|
| Dataset is very large | ~100 million rows may be slow to work with. | Start with a smaller, representative sample first. |
| No product names in the data | Screens will show "item 2268318" instead of a real product name. Feels less polished in demos. | Present it as category-level insights; if we ever need real product names, we'll add the Amazon dataset later. |
| Risk to the existing B2B app | Any change could accidentally break something planners already rely on. | The new work is kept in separate files with a `b2c_` prefix and a separate run command. The existing pipeline is not modified. |
| Client-side login isn't secure enough for real customers | Fine for internal planners, not fine for the public. | Only matters if Flavor B is approved. At that point, we'd move authentication to the backend. |

## 9. Ask

Approval to proceed with **Flavor A** (customer insights for the planner) on the `feature/b2c` branch. Flavor B (a customer-facing shopping experience) to be revisited once Flavor A is live and reviewed.
