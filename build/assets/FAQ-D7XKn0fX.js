import{j as e}from"./web3-vendor-DEvLGMBw.js";import{r as a}from"./react-vendor-BTPJ9MfQ.js";import{L as l}from"./Layout-BV08fSdX.js";import"./index-BkRxUkoc.js";function c({title:n,titleId:s,...r},o){return a.createElement("svg",Object.assign({xmlns:"http://www.w3.org/2000/svg",viewBox:"0 0 24 24",fill:"currentColor","aria-hidden":"true","data-slot":"icon",ref:o,"aria-labelledby":s},r),n?a.createElement("title",{id:s},n):null,a.createElement("path",{fillRule:"evenodd",d:"M12.53 16.28a.75.75 0 0 1-1.06 0l-7.5-7.5a.75.75 0 0 1 1.06-1.06L12 14.69l6.97-6.97a.75.75 0 1 1 1.06 1.06l-7.5 7.5Z",clipRule:"evenodd"}))}const d=a.forwardRef(c),x=()=>{const[n,s]=a.useState(null),r=[{question:"What is a bonding curve?",answer:`A bonding curve is a mathematical function that defines the relationship between a token's price and its supply. It creates a dynamic pricing mechanism that automatically adjusts based on demand.

Key points:
• As supply increases, price increases
• As supply decreases, price decreases
• This creates a dynamic pricing mechanism that automatically adjusts based on demand`},{question:"How do I create a token?",answer:`To create a token on BondX:

1. Go to 'Create Token' page
2. Fill in token details (name, symbol, etc.)
3. Upload an image (optional)
4. Add social links (optional)
5. Review details
6. Pay small fee in ETH
7. Wait for confirmation

Your token will then be live and tradable!`},{question:"How is the token price determined?",answer:`Token price is determined dynamically by the bonding curve.

• Buying tokens: Price increases
• Selling tokens: Price decreases

This creates a fair and transparent pricing mechanism reflecting real-time supply and demand.`},{question:"Can I sell my tokens at any time?",answer:`Yes, you can sell your tokens back to the contract at any time.

• Sell price: Determined by current position on the bonding curve
• Ensures continuous liquidity
• Allows you to exit your position whenever you choose`},{question:"Is there a fee for buying or selling tokens?",answer:`Yes, there's a small fee (typically 1%) for buying and selling.

Purposes of the fee:
1. Incentivize long-term holding
2. Prevent market manipulation
3. Contribute to platform sustainability
4. Potentially reward token holders or fund development`}],o=t=>{s(n===t?null:t)};return e.jsx(l,{children:e.jsxs("div",{className:"max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12",children:[e.jsx("h1",{className:"text-xl sm:text-2xl font-bold text-white mb-8 text-center",children:"Frequently Asked Questions"}),e.jsx("div",{className:"space-y-4",children:r.map((t,i)=>e.jsxs("div",{className:"bg-[var(--card)] rounded-lg overflow-hidden",children:[e.jsxs("button",{className:"w-full text-left p-4 sm:p-5 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-opacity-50 flex justify-between items-center hover:bg-[var(--card-hover)] transition-colors",onClick:()=>o(i),children:[e.jsx("h3",{className:"text-sm sm:text-base font-semibold text-white pr-4",children:t.question}),e.jsx(d,{className:`w-5 h-5 text-[var(--primary)] transition-transform duration-300 flex-shrink-0 ${n===i?"transform rotate-180":""}`})]}),e.jsx("div",{className:`overflow-hidden transition-all duration-300 ease-in-out ${n===i?"max-h-[1000px]":"max-h-0"}`,children:e.jsx("div",{className:"p-4 sm:p-5 bg-[var(--card2)]",children:e.jsx("p",{className:"text-xs sm:text-sm text-gray-400 whitespace-pre-line leading-relaxed",children:t.answer})})})]},i))})]})})};export{x as default};
