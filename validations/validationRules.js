// validationRules.js
module.exports = {
  "adobe" : {
  "Reload Home Page": {
    expectedHits: [
      {
        v10: "en_gb:home",
        v11: "en_gb",
        v12: "home",
        v114: /.*/,
        v115: /.*/,
        v199: /.*/,
        pageName: /en_gb:home/i,
      },
    ],
  },

  "Run JS Navigation & Click": {
    expectedHits: [
      {
        v1: "guest",
        v10: "en_gb:home",
        v11: "en_gb",
        v12: "home",
        v115: /.+\|.+\|.+\|.+\|\|\|.+\|.+\|/,
        v116: /pv|o/,
        v143: /\d+x\d+/,
        pageName: /en_gb:home/i,
        events: /event12/,
      },
    ],
  },

  "Click First Product": {
    expectedHits: [
      {
        v10: "en_gb:pdp:theiconicmeshpoloshirt",
        v11: "en_gb",
        v12: "product",
        v13: "no",
        v15: "men",
        v115: /.+\|.+\|.+\|.+\|\|\|.+\|.+\|/,
        v116: /pv|o/,
        v143: /\d+x\d+/,
        pageName: /en_gb:pdp:theiconicmeshpoloshirt/i,
        events: [/prodView/],
        products: [
          /eVar22=[^\|]+/,
          /eVar24=[^\|]+/,
          /eVar81=\d+:[^\|]+/,
          /eVar27=[^\|]+/,
          /eVar17/,
        ],
      },
    ],
  },

  "Select First Colour": {
    expectedHits: [
      {
        v10: "en_gb:pdp:theiconicmeshpoloshirt",
        events: /event30/,
        pev2: "Colour Swatch Click",
        v17: /black/,
        products: [/;[v\d]+;;;;eVar71=[^\|]+/],
      },
    ],
  },

  "Select Second Size": {
    expectedHits: [
      {
        v10: "en_gb:pdp:theiconicmeshpoloshirt",
        events: /event136/,
        pev2: "Size Selector",
        products: /eVar70=/,
      },
    ],
  },

  "Checkout as Guest Load Checkout Page": {
    expectedHits: [
      {
        c1: "checkout",
        c3: "checkout",
        c6: "checkout",
        v10: "en_gb:checkout:shipping",
        v11: "en_gb",
        v12: "checkout",
        pageName: "en_gb:checkout:shipping",
        events: /event106,event350/,
      },
    ],
  },

  "Select Express Shipping": {
    expectedHits: [
      {
        v10: "en_gb:checkout:shipping",
        events: "event182",
        pev2: "Checkout Refresh - Shipping Method Select",
        v129: /Test Incorrect Value/,
      },
    ],
  },

  "Click Continue to Payment": {
    expectedHits: [
      {
        pev2: "Checkout Shipping Method Save & Continue",
        v10: /checkout:billing/,
        v11: /en_gb|fr_fr|de_de/,
        v12: "checkout",
        events: [/event353/, /event354/],
      },
    ],
  },

  "Add to Cart": {
    expectedHits: [
      {
        v10: "en_gb:pdp:theiconicmeshpoloshirt",
        events: /scAdd/,
      },
    ],
  },
},
"cja" : {
  "Reload Home Page": {
    expectedHits: [
      {
        "xdm.eventType": "web.webinteraction.pageViews",
        "xdm.person.gender" : "not_specified",
        "xdm.person._polo.sessionID": /.*/,
        "xdm.person._polo.loginState": "guest",
        "xdm.person._polo.storeID": "guest",
        "xdm.web.webPageDetails.server": "development-tw.sfcc-ralphlauren-as.com",
        "xdm.web.webPageDetails.URL": /https:\/\/development-tw.sfcc-ralphlauren-as.com\/.*/,
        "xdm.web.webPageDetails.name": "zh_TW:home",
        "xdm.web.webPageDetails.pageViews.id": "zh_TW:home",
        "xdm.web.webPageDetails.pageViews.value": "1",
        "xdm.web.webPageDetails._polo.locale": "zh_TW",
        "xdm.web.webPageDetails._polo.dcEnvironment": "development",
        "xdm.web.webPageDetails._polo.dcLibrary": "2025-cf1",
        "xdm.web.webPageDetails._polo.pageType": "home",
        "xdm.web.webPageDetails._polo.searchExperience": /.*/,
        "xdm.web.webPageDetails._polo.consentCategories": "1,2,3,4",
        "xdm.web.webPageDetails._polo.userLoadTime": /.*/,
        "xdm.web.webPageDetails._polo.isRedirect": "false",
        "xdm.web.webPageDetails._polo.isOptimized": "true",
      },
    ],
  },
  "Go to PLP": {
    expectedHits: [
      {
        "xdm.eventType": "commerce.productListViews",
        "xdm.web.webInteraction._polo.optOut": "false",
        "xdm.web.webInteraction._polo.optOut": "FALSE",
        "xdm.web.webInteraction.region": "TW",
        "xdm.productListItems.0._id": /.*/,
        "xdm.productListItems.0.name": /.*/,
        "xdm.productListItems.0.productCategories.0.categoryName": /.*/,
        "xdm.productListItems.0.SKU": /.*/,
      }
    ],
      },
      "Click First Product": {
    expectedHits: [
      {
        "xdm.eventType": "commerce.productViews",
        "xdm.web.webPageDetails.URL": /https:\/\/development-tw.sfcc-ralphlauren-as.com\/.*/,
        "xdm.web.webPageDetails.name": /zh_TW:pdp:.*/,
        "xdm.web.webPageDetails.pageViews.id": /zh_TW:pdp:.*/,
        "xdm.web.webPageDetails.pageViews.value": "1",
        "xdm.web.webPageDetails._polo.locale": "zh_TW",
        "xdm.web.webPageDetails._polo.dcEnvironment": "development",
        "xdm.web.webPageDetails._polo.dcLibrary": "2025-cf1",
        "xdm.web.webPageDetails._polo.pageType": "product",
        "xdm.web.webPageDetails._polo.searchExperience": /.*/,
        "xdm.web.webPageDetails._polo.consentCategories": "1,2,3,4",
        "xdm.web.webPageDetails._polo.userLoadTime": /.*/,
        "xdm.web.webPageDetails._polo.isRedirect": "false",
        "xdm.web.webPageDetails._polo.isOptimized": "true",
        "xdm.web.webPageDetails._polo.gender": "men",
        "xdm.web.webPageDetails._polo.pageHierarchy.0": "男士",
        "xdm.web.webPageDetails._polo.pageHierarchy.1": "服裝",
        "xdm.web.webPageDetails._polo.pageHierarchy.2": "polo 衫",
        "xdm.web.webPageDetails._polo.pageHierarchyString": "男士|服裝|polo 衫",
        "data.product.item.0.productID": "100050784",
        "data.product.item.0.productName" : "Custom Slim Fit Stretch Oxford Mesh Polo",
        "data.product.item.0.productLongDescription": "100050784:Custom Slim Fit Stretch Oxford Mesh Polo",
        "data.product.item.0.productPrice": /.*/,
        "data.product.item.0.productStockMessage": /.*/,
        "data.product.item.0.productPriceType": "FP/PROMO",
        "data.product.item.0.productWebCategory" : "men-clothing-poloshirts",
        "data.product.item.0.productDivision" : "Men",
        "data.product.item.0.productBrand" : "Polo Ralph Lauren",
        "data.product.item.0.productCategory" : "men-clothing-poloshirts",
        "data.product.item.0.productIDandName": "100050784:Custom Slim Fit Stretch Oxford Mesh Polo",
        "data.product.item.1.productID": /.*/,
        "data.product.item.1.productName" : /.*/,
        "data.product.item.1.productLongDescription": /.*/,
        "data.product.item.1.productPrice": /.*/,
      },
    ],
  },
  "Add to Cart": {
    expectedHits: [
      {
        "xdm.eventType": "commerce.productListAdds",
        "xdm.productListItems.0._id": "100050784",
        "xdm.productListItems.0.name": "Custom Slim Fit Stretch Oxford Mesh Polo",
        "xdm.productListItems.0.SKU": "3616853611125",
        "xdm.productListItems.0.quantity": "1",
        "xdm.productListItems.0.productCategories.0.categoryID" : "Men",
        "xdm.productListItems.0.productCategories.0.categoryName" : "Men",
        "xdm.productListItems.0.productCategories.1.categoryID" : "Clothing",
        "xdm.productListItems.0.productCategories.1.categoryName" : "Clothing",
        "xdm.productListItems.0.productCategories.2.categoryID" : "Polo Shirts",
        "xdm.productListItems.0.productCategories.2.categoryName" : "Polo Shirts",
        "xdm.productListItems.0.currencyCode": "TWD",
        "xdm.productListItems.0.productAddMethod": "product",
        "xdm.productListItems.0._polo.salePrice.amount": "5480",
        "xdm.productListItems.0._polo.salePrice.conversionDate": "2025-11-22T13:03:22.022Z",
        "xdm.productListItems.0._polo.salePrice.currencyCode": "TWD",
        "xdm.productListItems.0._polo.brand": "Polo Ralph Lauren",
        "xdm.productListItems.0._polo.division": "Men",
        "xdm.productListItems.0._polo.priceType": "FP/PROMO",
        "xdm.productListItems.0._polo.productGroup": "RLE",
        "xdm.productListItems.0._polo.category": "men-clothing-poloshirts",
        "xdm.productListItems.0._polo.color": "職場藍/白色",
        "xdm.productListItems.0._polo.size": "S",
        "xdm.productListItems.0._polo.addedFrom": "product",
        "xdm.productListItems.0._polo.stockMessage": "IN_STOCK",
        "xdm.productListItems.0._polo.freeForm": "webcat=men-clothing-poloshirts",
        "xdm.web.webPageDetails.URL": "https://development-tw.sfcc-ralphlauren-as.com/zh/custom-slim-fit-stretch-oxford-mesh-polo-100050784.html?cgid=men-clothing-poloshirts#start=1&cgid=men-clothing-poloshirts",
        "xdm.web.webPageDetails.queryParameters": "?cgid=men-clothing-poloshirts",
        "xdm.web.webPageDetails.server": "development-tw.sfcc-ralphlauren-as.com",
        "xdm.web.webPageDetails.name": "zh_TW:pdp:CustomSlimFitStretchOxfordMeshPolo",
        "xdm.web.webPageDetails.viewName": "full",

        "xdm.web.webPageDetails._polo.locale": "zh_TW",
        "xdm.web.webPageDetails._polo.dcEnvironment": "development",
        "xdm.web.webPageDetails._polo.dcLibrary": "2025-cf1",
        "xdm.web.webPageDetails._polo.pageType": "product",
        "xdm.web.webPageDetails._polo.pageSubType": "",
        "xdm.web.webPageDetails._polo.tickerText": "",
        "xdm.web.webPageDetails._polo.searchExperience": "BR",
        "xdm.web.webPageDetails._polo.consentCategories": "1,2,3,4",
        "xdm.web.webPageDetails._polo.userLoadTime": /.*/,
        "xdm.web.webPageDetails._polo.priceOrder.0": "FP",
        "xdm.web.webPageDetails._polo.sizeChartType": "dynamic",
        "xdm.web.webPageDetails._polo.pdpTemplate": "basic",
        "xdm.web.webPageDetails._polo.isFeaturedProduct": "false",
        "xdm.web.webPageDetails._polo.gender": "men",
        "xdm.web.webPageDetails._polo.findingMethod": "browse",
        "xdm.web.webPageDetails._polo.isRedirect": "false",
        "xdm.web.webPageDetails._polo.isOptimized": "true",

        "xdm.web.webPageDetails._polo.pageHierarchy.0": "男士",
        "xdm.web.webPageDetails._polo.pageHierarchy.1": "服裝",
        "xdm.web.webPageDetails._polo.pageHierarchy.2": "polo 衫",
        "xdm.web.webPageDetails._polo.pageHierarchyString": "TEST INCORRECT VALUE",

        "xdm.web.webInteraction.name": "Add to Cart",
        
      }
    ],
      },
}
};
