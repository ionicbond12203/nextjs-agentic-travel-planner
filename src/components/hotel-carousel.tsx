"use client";

import React from "react";

interface Hotel {
  name: string;
  rating: number;
  price: string;
  image?: string;
  description: string;
  bookingUrl: string;
}

interface HotelCarouselProps {
  title: string;
  hotels: Hotel[];
}

const HotelCarousel: React.FC<HotelCarouselProps> = ({ title, hotels }) => {
  return (
    <div className="my-6 w-full animate-fade-in">
      <div className="flex items-center justify-between mb-4 px-1">
        <h3 className="text-lg font-bold text-strong flex items-center gap-2">
          🏨 {title}
        </h3>
        <span className="text-xs text-muted bg-surface-hover px-2 py-1 rounded-full border border-border">
          左右滑动查看更多
        </span>
      </div>

      {/* Carousel Container */}
      <div 
        className="flex gap-4 overflow-x-auto pb-4 px-1 no-scrollbar"
        style={{
          scrollSnapType: "x Mandatory",
          WebkitOverflowScrolling: "touch",
          scrollbarWidth: "none", // Firefox
          msOverflowStyle: "none", // IE
        }}
      >
        {hotels.map((hotel, idx) => (
          <div
            key={`${hotel.name}-${idx}`}
            className="flex-shrink-0 w-[280px] bg-surface border border-border rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all duration-300 group"
            style={{ 
              scrollSnapAlign: "start",
            }}
          >
            {/* Image Placeholder or Actual Image */}
            <div className="h-40 bg-muted relative overflow-hidden">
              {hotel.image ? (
                <img 
                  src={hotel.image} 
                  alt={hotel.name} 
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-indigo-500/20 to-purple-500/20">
                  <span className="text-4xl opacity-50">🏨</span>
                </div>
              )}
              <div className="absolute top-3 right-3 bg-white/90 dark:bg-black/80 backdrop-blur-md px-2 py-1 rounded-lg text-xs font-bold text-accent shadow-sm">
                {hotel.price}
              </div>
            </div>

            {/* Content */}
            <div className="p-4 flex flex-col h-[180px]">
              <div className="flex justify-between items-start mb-1">
                <h4 className="font-bold text-strong line-clamp-1 flex-1 leading-tight">
                  {hotel.name}
                </h4>
                <div className="flex items-center gap-1 ml-2 shrink-0">
                  <span className="text-yellow-500 text-xs">⭐</span>
                  <span className="text-xs font-bold text-strong">{hotel.rating}</span>
                </div>
              </div>

              <p className="text-xs text-muted line-clamp-3 mb-4 flex-1 leading-relaxed">
                {hotel.description}
              </p>

              <a
                href={hotel.bookingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-auto w-full py-2.5 bg-surface-hover hover:bg-accent hover:text-white border border-border hover:border-accent text-strong text-xs font-bold rounded-xl text-center transition-all duration-200"
              >
                查看详情
              </a>
            </div>
          </div>
        ))}
        
        {/* Padding for the end of the scroll */}
        <div className="flex-shrink-0 w-2 h-full" />
      </div>

      <style jsx>{`
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </div>
  );
};

export default HotelCarousel;
