import React, { useEffect, useRef, useState, useMemo } from "react";
import Hls from "hls.js";
import { motion, AnimatePresence } from "motion/react";
import { Channel } from "./types";
import { FALLBACK_CHANNELS } from "./channelsData";
import {
  parseM3U,
  getInitials,
  getFallbackGradient,
  calculateLiveStats,
  sortCategories,
} from "./utils";
import { 
  Play, 
  Pause, 
  SkipBack, 
  SkipForward, 
  Maximize2, 
  Tv, 
  Sun, 
  Moon, 
  Plus, 
  Trash2, 
  CheckCircle, 
  Upload, 
  Star, 
  Search, 
  Eye, 
  Smartphone, 
  Users, 
  ChevronLeft, 
  ChevronRight,
  Info,
  Database,
  Grid,
  Sparkles,
  AlertTriangle,
  X
} from "lucide-react";

// Helper to generate bigrams for Dice's coefficient spelling checks
function getBigrams(str: string): string[] {
  const bigrams: string[] = [];
  for (let i = 0; i < str.length - 1; i++) {
    bigrams.push(str.substring(i, i + 2));
  }
  return bigrams;
}

// Tolerant spelling & spacing correction matcher
function isFuzzyMatch(name: string, query: string): boolean {
  if (!query) return true;
  
  const cleanStr = (str: string) => {
    return str
      .toLowerCase()
      .trim()
      .replace(/[\s\-_./,\(\)\[\]+@!#%^&*:=\\]/g, ""); // strip whitespace and punctuation
  };

  const nName = cleanStr(name);
  const nQuery = cleanStr(query);

  if (!nQuery) return false;

  // 1. Direct exact or substring matches
  if (nName.includes(nQuery) || nQuery.includes(nName)) {
    return true;
  }

  // 2. Subsequence check (char sequence matching in order)
  let qIdx = 0;
  for (let cIdx = 0; cIdx < nName.length; cIdx++) {
    if (nName[cIdx] === nQuery[qIdx]) {
      qIdx++;
    }
    if (qIdx === nQuery.length) {
      return true;
    }
  }

  // 3. Spell check / Typo tolerance via Dice's Coefficient (Bigram Matcher)
  if (nQuery.length < 3) {
    return false; // too short for fuzzy bigram matching to be helpful without false positives
  }

  const nameBigrams = getBigrams(nName);
  const queryBigrams = getBigrams(nQuery);

  if (nameBigrams.length === 0 || queryBigrams.length === 0) {
    return false;
  }

  let matches = 0;
  const nameBigramSet = new Set(nameBigrams);
  queryBigrams.forEach(bg => {
    if (nameBigramSet.has(bg)) {
      matches++;
    }
  });

  const diceScore = (2 * matches) / (nameBigrams.length + queryBigrams.length);

  // If score is 0.40 or higher, we consider it a spelling mistake match!
  return diceScore >= 0.40;
}

export default function App() {
  const [viewMode, setViewMode] = useState<"3d" | "2d">("3d");
  const [channels, setChannels] = useState<Channel[]>(FALLBACK_CHANNELS);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [currentChannel, setCurrentChannel] = useState<Channel | null>(null);
  const [currentCategory, setCurrentCategory] = useState<string>("All");
  const [searchKeyword, setSearchKeyword] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isBuffering, setIsBuffering] = useState<boolean>(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");

  // Search History State
  const [searchHistory, setSearchHistory] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem("live_tv_search_history");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const addToSearchHistory = (keyword: string) => {
    const trimmed = keyword.trim();
    if (!trimmed || trimmed.length < 2) return;
    setSearchHistory((prev) => {
      const filtered = prev.filter((item) => item.toLowerCase() !== trimmed.toLowerCase());
      const updated = [trimmed, ...filtered].slice(0, 6);
      localStorage.setItem("live_tv_search_history", JSON.stringify(updated));
      return updated;
    });
  };

  const clearSearchHistory = () => {
    setSearchHistory([]);
    localStorage.removeItem("live_tv_search_history");
  };

  // State-based confirmation for deleting channel to avoid sandboxed iframe window.confirm blocks
  const [pendingDeleteUrl, setPendingDeleteUrl] = useState<string | null>(null);

  // State-based confirmation for re-loading template channels
  const [showRestoreConfirm, setShowRestoreConfirm] = useState<boolean>(false);

  // Dark/Light Theme System
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  // Admin authentication states for securing playlist manager
  const [adminPassword, setAdminPassword] = useState<string>(
    () => localStorage.getItem("adminPassword") || ""
  );
  const [loginInputWord, setLoginInputWord] = useState<string>("");
  const [loginError, setLoginError] = useState<string>("");

  const isAdminAuthenticated = useMemo(() => {
    return adminPassword === "416737@";
  }, [adminPassword]);

  // Admin states for managing channels inside the app
  const [newChanName, setNewChanName] = useState<string>("");
  const [newChanUrl, setNewChanUrl] = useState<string>("");
  const [newChanLogo, setNewChanLogo] = useState<string>("");
  const [newChanCategory, setNewChanCategory] = useState<string>("Entertainment");
  const [m3uPasteText, setM3uPasteText] = useState<string>("");
  const [m3uImportMode, setM3uImportMode] = useState<"merge" | "replace">("merge");
  
  // Status feedback messages
  const [successMsg, setSuccessMsg] = useState<string>("");
  const [adminError, setAdminError] = useState<string>("");

  // States for bulk item selection and confirmation in admin table
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState<boolean>(false);

  // Stats
  const [liveCount, setLiveCount] = useState<number>(20);
  const [mobileCount, setMobileCount] = useState<number>(5);
  const [totalCount, setTotalCount] = useState<number>(9850);

  // References to keep state fresh in interval/pings without closures
  const currentChannelRef = useRef<Channel | null>(null);
  useEffect(() => {
    currentChannelRef.current = currentChannel;
  }, [currentChannel]);

  // Unique client/device visitor tracker identifier
  const visitorId = useMemo(() => {
    let id = localStorage.getItem("live_tv_visitor_id");
    if (!id) {
      id = "visitor_" + Math.random().toString(36).substring(2, 15) + "_" + Date.now();
      localStorage.setItem("live_tv_visitor_id", id);
    }
    return id;
  }, []);

  // Detect mobile device
  const isMobileDevice = useMemo(() => {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768;
  }, []);

  // Theme Sync
  useEffect(() => {
    const savedTheme = localStorage.getItem("live_tv_theme") as "dark" | "light";
    if (savedTheme) {
      setTheme(savedTheme);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("live_tv_theme", theme);
    if (theme === "light") {
      document.body.classList.add("light-theme");
    } else {
      document.body.classList.remove("light-theme");
    }
  }, [theme]);

  // Server-side live stats synchronizer ping
  useEffect(() => {
    const sendPing = () => {
      fetch("/api/stats/ping", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          visitorId,
          channelUrl: currentChannelRef.current?.url || "",
          isMobile: isMobileDevice,
        }),
      })
        .then((res) => {
          if (!res.ok) throw new Error("Stats ping request failed");
          return res.json();
        })
        .then((data) => {
          if (data && typeof data.liveCount === "number") {
            setLiveCount(data.liveCount);
            setTotalCount(data.totalCount);
            setMobileCount(data.mobileCount !== undefined ? data.mobileCount : Math.floor(data.liveCount * 0.35));
          }
        })
        .catch((err) => {
          console.warn("Ping failed, falling back to simulated counter:", err);
          const fallback = calculateLiveStats();
          setLiveCount(fallback.liveCount);
          setTotalCount(fallback.totalCount);
          setMobileCount(Math.floor(fallback.liveCount * 0.4));
        });
    };

    // Ping immediately and set up tick every 10 seconds
    sendPing();
    const interval = setInterval(sendPing, 10000);

    return () => {
      clearInterval(interval);
    };
  }, [visitorId, isMobileDevice]);

  // Modals & Banner
  const [activeModal, setActiveModal] = useState<"privacy" | "terms" | "disclaimer" | "warning" | "update" | "adminLogin" | null>(null);

  // Secure path protection: if category is "Manage" and not logged in as admin, redirect out
  useEffect(() => {
    if (currentCategory === "Manage" && !isAdminAuthenticated) {
      setCurrentCategory("All");
    }
  }, [currentCategory, isAdminAuthenticated]);

  // References
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const categoriesContainerRef = useRef<HTMLDivElement | null>(null);

  // Initial Fetching channels from Database
  const loadDatabaseChannels = () => {
    setIsLoading(true);
    fetch("/api/channels")
      .then((res) => {
        if (!res.ok) throw new Error("Server database endpoint failed");
        return res.json();
      })
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setChannels(data);
          // Play default channel
          const defaultIndex = data.findIndex((c) =>
            c.name.toLowerCase().includes("channel i")
          );
          playChannelByIndex(defaultIndex !== -1 ? defaultIndex : 0, data);
        } else {
          // If empty DB, use fallbacks
          setChannels(FALLBACK_CHANNELS);
          playChannelByIndex(0, FALLBACK_CHANNELS);
        }
        setIsLoading(false);
      })
      .catch((err) => {
        console.warn("Could not load from /api/channels, trying offline files:", err);
        // Fallback file load logic
        fetch("/channels.m3u")
          .then((res) => {
            if (!res.ok) throw new Error("Local channels.m3u file unavailable");
            return res.text();
          })
          .then((text) => {
            const parsed = parseM3U(text);
            if (parsed.length > 0) {
              setChannels(parsed);
              playChannelByIndex(0, parsed);
            } else {
              setChannels(FALLBACK_CHANNELS);
              playChannelByIndex(0, FALLBACK_CHANNELS);
            }
            setIsLoading(false);
          })
          .catch((e) => {
            console.warn("Both database and local file failing, using hardcoded static data:", e);
            setChannels(FALLBACK_CHANNELS);
            playChannelByIndex(0, FALLBACK_CHANNELS);
            setIsLoading(false);
          });
      });
  };

  useEffect(() => {
    // 1. View Mode from localStorage
    const savedMode = localStorage.getItem("viewMode");
    if (savedMode === "2d" || savedMode === "3d") {
      setViewMode(savedMode);
    }

    // 2. Favorites from localStorage
    try {
      const savedFavs = localStorage.getItem("live_tv_channel_favorites");
      if (savedFavs) {
        setFavorites(JSON.parse(savedFavs));
      }
    } catch (e) {
      console.warn("Could not load favorites from localStorage", e);
    }

    // 3. Disclaimer Check
    const accepted = localStorage.getItem("live_tv_channel_disclaimer_accepted");
    if (!accepted) {
      setActiveModal("disclaimer");
    }

    // 4. Load full DB channels
    loadDatabaseChannels();

    return () => {};
  }, []);

  // Update View Mode localstorage helper
  const handleViewModeChange = (mode: "2d" | "3d") => {
    setViewMode(mode);
    localStorage.setItem("viewMode", mode);
  };

  // Categories Calculation
  const categories = useMemo(() => {
    const rawCats = new Set<string>();
    channels.forEach((ch) => {
      ch.categories.forEach((cat) => {
        if (cat) rawCats.add(cat);
      });
    });
    return sortCategories(Array.from(rawCats));
  }, [channels]);

  // Filtered Channels Mapping
  const filteredChannels = useMemo(() => {
    return channels.filter((ch) => {
      let matchesCategory = false;
      if (currentCategory === "All") {
        matchesCategory = true;
      } else if (currentCategory === "Favorites") {
        matchesCategory = favorites.includes(ch.url);
      } else if (currentCategory === "Manage") {
        // Administration page handles its own logic, showing matches
        matchesCategory = true;
      } else {
        matchesCategory = ch.categories.includes(currentCategory);
      }
      const matchesSearch = isFuzzyMatch(ch.name, searchKeyword);
      return matchesCategory && matchesSearch;
    });
  }, [channels, currentCategory, favorites, searchKeyword]);

  // Debounce search input to add successful matches to search history
  useEffect(() => {
    const trimmed = searchKeyword.trim();
    if (!trimmed || trimmed.length < 3) return;

    const handler = setTimeout(() => {
      if (filteredChannels.length > 0) {
        addToSearchHistory(trimmed);
      }
    }, 1500);

    return () => clearTimeout(handler);
  }, [searchKeyword, filteredChannels.length]);

  // Dynamic Scroll Indicator Controls for top categories bar
  const scrollCategories = (direction: "left" | "right") => {
    if (categoriesContainerRef.current) {
      const scrollAmount = 200;
      categoriesContainerRef.current.scrollBy({
        left: direction === "left" ? -scrollAmount : scrollAmount,
        behavior: "smooth",
      });
    }
  };

  // Playback Operations
  const playChannelByIndex = (index: number, activeList = filteredChannels) => {
    if (index < 0 || index >= activeList.length) return;
    const channel = activeList[index];
    setCurrentChannel(channel);
    startStream(channel);
  };

  const startStream = (channel: Channel) => {
    const video = videoRef.current;
    if (!video) return;

    // Reset loaders and error stats
    setIsBuffering(true);
    setErrorMessage("");

    // Destroy existing HLS instances
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const testMixedContentWarning = () => {
      const isHttpsPage = window.location.protocol === "https:";
      const isInsecureStream = channel.url.startsWith("http://");
      if (isHttpsPage && isInsecureStream) {
        setActiveModal("warning");
        setErrorMessage("Block Mixed Content Error");
        setIsBuffering(false);
        setIsPlaying(false);
        return true;
      }
      return false;
    };

    if (Hls.isSupported()) {
      const hls = new Hls({
        maxMaxBufferLength: 10,
        enableWorker: true,
      });
      hlsRef.current = hls;
      hls.loadSource(channel.url);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play()
          .then(() => setIsPlaying(true))
          .catch((err) => {
            console.log("Autoplay blocked:", err);
            setIsBuffering(false);
            setIsPlaying(false);
          });
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          console.warn("HLS fatal error encountered, trying recovery...", data);
          if (testMixedContentWarning()) return;

          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              setErrorMessage("Stream unavailable ⚠️");
              setIsBuffering(false);
              break;
          }
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // Native Apple HLS (Safari/iOS)
      video.src = channel.url;
      video.onerror = () => {
        if (!testMixedContentWarning()) {
          setErrorMessage("Stream unavailable ⚠️");
          setIsBuffering(false);
        }
      };

      video.addEventListener("loadedmetadata", () => {
        video.play()
          .then(() => setIsPlaying(true))
          .catch((err) => {
            console.log("Autoplay prevented:", err);
            setIsBuffering(false);
            setIsPlaying(false);
          });
      });
    } else {
      setErrorMessage("No HLS decoding support in this browser.");
      setIsBuffering(false);
    }

    video.onplaying = () => {
      setIsBuffering(false);
      setIsPlaying(true);
    };

    video.onwaiting = () => {
      setIsBuffering(true);
    };

    video.onended = () => {
      nextChannel();
    };
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play()
        .then(() => setIsPlaying(true))
        .catch(() => setIsPlaying(false));
    } else {
      video.pause();
      setIsPlaying(false);
    }
  };

  const nextChannel = () => {
    const activeList = filteredChannels.length > 0 ? filteredChannels : channels;
    if (activeList.length === 0) return;
    const index = activeList.findIndex((c) => currentChannel && c.url === currentChannel.url);
    const nextIdx = (index + 1) % activeList.length;
    playChannelByIndex(nextIdx, activeList);
  };

  const prevChannel = () => {
    const activeList = filteredChannels.length > 0 ? filteredChannels : channels;
    if (activeList.length === 0) return;
    const index = activeList.findIndex((c) => currentChannel && c.url === currentChannel.url);
    const prevIdx = index <= 0 ? activeList.length - 1 : index - 1;
    playChannelByIndex(prevIdx, activeList);
  };

  const toggleFullscreen = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.requestFullscreen) {
      video.requestFullscreen();
    } else if ((video as any).webkitRequestFullscreen) {
      (video as any).webkitRequestFullscreen();
    } else if ((video as any).webkitEnterFullscreen) {
      (video as any).webkitEnterFullscreen();
    }
  };

  // Video Pop-up Picture in Picture (PiP) implementation
  const togglePiP = async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureEnabled) {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
        } else {
          await video.requestPictureInPicture();
        }
      } else {
        alert("আপনার ব্রাউজারে Picture-In-Picture বা ভাসমান ভিডিও উইন্ডো ফিচারটি সমর্থিত নয়। ওয়ান-ক্লিক প্লেপ্যাকের জন্য গুগল ক্রোম, সাফারি বা ফায়ারফক্স ব্রাউজারে এটি ওপেন করুন।");
      }
    } catch (err: any) {
      console.warn("PiP failed structure:", err);
      alert("উইন্ডো পপ-আপ চালু করার জন্য প্রথমে চ্যানেলটিতে সিগন্যাল থাকতে হবে বা চ্যানেলটি অলরেডি ব্যাকগ্রাউন্ডে চলতে হবে।");
    }
  };

  // Bookmark Favorites Handlers
  const toggleFavorite = (e: React.MouseEvent, url: string) => {
    e.stopPropagation();
    let updated;
    if (favorites.includes(url)) {
      updated = favorites.filter((f) => f !== url);
    } else {
      updated = [...favorites, url];
    }
    setFavorites(updated);
    localStorage.setItem("live_tv_channel_favorites", JSON.stringify(updated));
  };

  // Add customized Channel to server-side JSON and refresh list
  const handleAddNewChannel = (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMsg("");
    setAdminError("");

    if (!newChanName.trim() || !newChanUrl.trim()) {
      setAdminError("চ্যানেলের নাম এবং স্ট্রিমিং ও ম্যাস URL খালি রাখা যাবে না!");
      return;
    }

    const payload = {
      name: newChanName.trim(),
      url: newChanUrl.trim(),
      logo: newChanLogo.trim(),
      categories: [newChanCategory.trim() || "Other"]
    };

    fetch("/api/channels", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "x-admin-password": adminPassword
      },
      body: JSON.stringify(payload),
    })
      .then((res) => {
        if (!res.ok) throw new Error("চ্যানেল তৈরি স্ট্রিম ব্যর্থ হয়েছে");
        return res.json();
      })
      .then((data) => {
        if (data.success) {
          setSuccessMsg(`চ্যানেল "${payload.name}" সফলভাবে ডাটাবেজে যুক্ত ও সংরক্ষিত করা হয়েছে!`);
          setNewChanName("");
          setNewChanUrl("");
          setNewChanLogo("");
          // Force state update
          if (Array.isArray(data.list)) {
            setChannels(data.list);
          } else {
            loadDatabaseChannels();
          }
        }
      })
      .catch((err) => {
        setAdminError("সার্ভার ডাটাবেজে চ্যানেলটি সংরক্ষণ করা যায়নি: " + err.message);
      });
  };

  // Delete channel from database
  const handleDeleteChannel = (url: string, name: string) => {
    setSuccessMsg("");
    setAdminError("");

    fetch("/api/channels/delete", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "x-admin-password": adminPassword
      },
      body: JSON.stringify({ url }),
    })
      .then((res) => {
        if (!res.ok) throw new Error("চ্যানেল ডিলিট সম্পন্ন হয়নি");
        return res.json();
      })
      .then((data) => {
        if (data.success) {
          setSuccessMsg(`চ্যানেল "${name}" সফলভাবে ডিলিট করা হয়েছে!`);
          if (Array.isArray(data.list)) {
            setChannels(data.list);
          } else {
            loadDatabaseChannels();
          }
          // Remove from selection if present
          setSelectedChannels(prev => prev.filter(u => u !== url));
        }
      })
      .catch((err) => {
        setAdminError("চ্যানেল ডিলিট ব্যর্থ হয়েছে: " + err.message);
      });
  };

  // Delete multiple channels from database (Highly efficient bulk delete)
  const handleDeleteMultipleChannels = () => {
    if (selectedChannels.length === 0) return;

    setSuccessMsg("");
    setAdminError("");

    fetch("/api/channels/delete-multiple", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "x-admin-password": adminPassword
      },
      body: JSON.stringify({ urls: selectedChannels }),
    })
      .then((res) => {
        if (!res.ok) throw new Error("বাল্ক ডিলিট সম্পন্ন হয়নি");
        return res.json();
      })
      .then((data) => {
        if (data.success) {
          setSuccessMsg(`নির্বাচিত ${selectedChannels.length} টি চ্যানেল সফলভাবে ডিলিট করা হয়েছে!`);
          setSelectedChannels([]);
          setShowBulkDeleteConfirm(false);
          if (Array.isArray(data.list)) {
            setChannels(data.list);
          } else {
            loadDatabaseChannels();
          }
        }
      })
      .catch((err) => {
        setAdminError("বাল্ক ডিলিট ব্যর্থ হয়েছে: " + err.message);
      });
  };

  // Import raw M3U text paste from client
  const handleImportM3UPlaylist = (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMsg("");
    setAdminError("");

    if (!m3uPasteText.trim()) {
      setAdminError("অনুগ্রহ করে টেক্সট এরিয়া বক্সে কোনো M3U কনটেন্ট টেক্সট পেস্ট করুন!");
      return;
    }

    const payload = {
      m3uText: m3uPasteText,
      isReplace: m3uImportMode === "replace"
    };

    fetch("/api/playlist/import", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "x-admin-password": adminPassword
      },
      body: JSON.stringify(payload),
    })
      .then((res) => {
        if (!res.ok) throw new Error("M3U ফাইল ইম্পোর্ট ও পার্সিং ব্যর্থ হয়েছে");
        return res.json();
      })
      .then((data) => {
        if (data.success) {
          setSuccessMsg(`ইম্পোর্ট সম্পন্ন! সফলভাবে ${data.count} টি চ্যানেল ডাটাবেজে যুক্ত হয়েছে। (সর্বমোট চ্যানেল সংখ্যা: ${data.total} টি)`);
          setM3uPasteText("");
          if (Array.isArray(data.list)) {
            setChannels(data.list);
          } else {
            loadDatabaseChannels();
          }
        }
      })
      .catch((err) => {
        setAdminError("M3U ইম্পোর্ট করতে সমস্যা হয়েছে: " + err.message);
      });
  };

  const resetToDefaultApp = (e: React.MouseEvent) => {
    e.preventDefault();
    setSearchKeyword("");
    setCurrentCategory("All");

    if (channels.length > 0) {
      const defaultIdx = channels.findIndex((c) => c.name.toLowerCase().includes("channel i"));
      playChannelByIndex(defaultIdx !== -1 ? defaultIdx : 0, channels);
    }

    // Scroll back to player
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const scrollToCategories = (e: React.MouseEvent) => {
    e.preventDefault();
    setSearchKeyword("");
    setCurrentCategory("All");
    const el = document.getElementById("categories-search-section");
    if (el) el.scrollIntoView({ behavior: "smooth" });
  };

  const handleDisclaimerAccept = () => {
    localStorage.setItem("live_tv_channel_disclaimer_accepted", "true");
    setActiveModal(null);
  };

  const handleFooterCatClick = (e: React.MouseEvent, cat: string) => {
    e.preventDefault();
    setCurrentCategory(cat);
    const el = document.getElementById("categories-search-section");
    if (el) el.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className={`view-container ${viewMode === "3d" ? "mode-3d" : "mode-2d"}`}>
      {/* Background Orbs */}
      <div className="bg-mesh fixed top-0 left-0 w-full h-full -z-50 overflow-hidden bg-[#07070a] transition-colors duration-500">
        <div className="glow-orb orb-1 absolute top-[-10%] left-[-10%] w-[50vw] h-[50vw] rounded-full bg-radial from-[#ff007f] to-transparent opacity-25"></div>
        <div className="glow-orb orb-2 absolute bottom-[-15%] right-[-10%] w-[60vw] h-[60vw] rounded-full bg-radial from-[#00f2fe] to-transparent opacity-25"></div>
        <div className="glow-orb orb-3 absolute top-[40%] left-[30%] w-[40vw] h-[40vw] rounded-full bg-radial from-[#9b51e0] to-transparent opacity-25"></div>
      </div>

      <div className="app-container flex flex-col lg:flex-row min-h-screen w-full max-w-[1920px] mx-auto relative z-10">
        {/* LEFT SECTION: PLAYER & METADATA */}
        <aside className={`player-section w-full lg:w-[420px] lg:min-w-[420px] ${viewMode === "3d" ? "shadow-[6px_0_20px_rgba(0,0,0,0.8)] border-none" : "border-r border-white/8"} bg-[#07070a]/70 lg:backdrop-blur-md p-6 lg:p-[30px] flex flex-col lg:h-screen lg:sticky lg:top-0 z-10`}>
          
          {/* Header */}
          <header className="header flex items-center justify-between mb-6 gap-[15px]">
            <div className="logo-container flex flex-row items-center gap-3">
              <span className="brand-logo text-3xl select-none animation-logoIconFloat">📺</span>
              <h1 className="logo font-poppins font-extrabold text-2.5xl tracking-tighter uppercase logo-shimmer">
                Live TV <span className="bg-transparent font-extrabold text-[#ff007f]">Channel</span>
              </h1>
            </div>

            {/* Header Widgets / Switch */}
            <div className="header-right-widgets flex items-center gap-[15px] ml-auto">
              {/* Theme Switcher Button */}
              <button 
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                className="p-2.5 rounded-full bg-white/5 border border-white/10 hover:bg-white/15 hover:scale-105 active:scale-95 text-white duration-300 cursor-pointer"
                title={theme === "dark" ? "Light Mode" : "Dark Mode"}
              >
                {theme === "dark" ? <Sun size={15} className="text-yellow-400" /> : <Moon size={15} className="text-indigo-400" />}
              </button>

              <div className="view-toggle-container relative flex bg-white/5 border border-white/8 p-[3px] rounded-[30px] w-[90px] h-[30px] items-center overflow-hidden">
                <div 
                  className={`view-toggle-slider absolute top-[2px] left-[2px] w-[41px] h-[24px] rounded-[20px] transition-all duration-300 ${viewMode === "2d" ? "translate-x-[43px] bg-linear-to-br from-[#9b51e0] to-[#ff007f]" : "bg-linear-to-br from-[#ff007f] to-[#9b51e0]"}`}
                ></div>
                <button 
                  onClick={() => handleViewModeChange("3d")}
                  className={`view-toggle-btn relative flex-1 text-[10px] font-bold font-display cursor-pointer z-10 text-center uppercase tracking-wider ${viewMode === "3d" ? "text-white" : "text-white/60"}`}
                >
                  3D
                </button>
                <button 
                  onClick={() => handleViewModeChange("2d")}
                  className={`view-toggle-btn relative flex-1 text-[10px] font-bold font-display cursor-pointer z-10 text-center uppercase tracking-wider ${viewMode === "2d" ? "text-white" : "text-white/60"}`}
                >
                  2D
                </button>
              </div>
            </div>
          </header>

          {/* Player Wrapper */}
          <div className="player-wrapper relative w-full flex flex-col">
            <div className={`video-container relative w-full aspect-video bg-black rounded-[18px] overflow-hidden transition-all duration-300 hover:translate-y-[-2px] ${viewMode === "3d" ? "neumorph-outset-dark hover:shadow-[14px_14px_28px_rgba(0,0,0,0.8),-14px_-14px_28px_rgba(255,255,255,0.05),inset_0_0_0_1px_rgba(255,255,255,0.05)] border-none" : "border border-white/8 hover:shadow-[0_20px_40px_rgba(0,0,0,0.7),0_0_25px_rgba(255,0,127,0.35)]"}`}>
              <video 
                ref={videoRef} 
                className="w-full h-full block object-contain"
                playsInline
                autoPlay
              />

              {/* Buffered Loader Overlay */}
              {(isBuffering || errorMessage) && (
                <div className="player-loader absolute top-0 left-0 w-full h-full bg-black/85 flex flex-col justify-center items-center gap-[15px] z-10">
                  {isBuffering && <div className="spinner w-[50px] h-[50px] border-3 border-[#00f2fe]/10 border-t-[#00f2fe] border-r-[#ff007f] rounded-full animate-spin"></div>}
                  <span className="text-white/80 font-display text-sm tracking-wider uppercase text-center px-4">
                    {errorMessage || "বাফারিং হচ্ছে..."}
                  </span>
                </div>
              )}
            </div>

            {/* Premium Control Bar */}
            <div className={`custom-controls mt-[15px] bg-[#12121d]/60 border border-white/8 rounded-[20px] flex justify-center items-center gap-[15px] p-2 px-3 backdrop-blur-md shadow-lg w-full ${viewMode === "3d" ? "neumorph-outset-dark border-none" : ""}`}>
              <button 
                onClick={prevChannel}
                className={`control-btn bg-white/10 hover:bg-[#b388ff] border border-white/10 hover:border-[#b388ff]/55 text-white active:scale-95 w-10 h-10 rounded-full flex items-center justify-center cursor-pointer transition-all duration-300 hover:scale-110`}
                title="পূর্ববর্তী চ্যানেল"
              >
                <SkipBack size={16} />
              </button>
              <button 
                onClick={togglePlay}
                className={`control-btn play-pause-btn bg-white hover:bg-[#00f2fe] hover:border-[#00f2fe] text-[#07070a] active:scale-95 w-12 h-12 rounded-full flex items-center justify-center cursor-pointer transition-all duration-300 hover:scale-110 ${viewMode === "3d" ? "bg-white/10 text-white border-none neumorph-outset-dark" : ""}`}
                title="প্লে / পজ"
              >
                {isPlaying ? <Pause size={20} /> : <Play size={20} />}
              </button>
              <button 
                onClick={nextChannel}
                className={`control-btn bg-white/10 hover:bg-[#b388ff] border border-white/10 hover:border-[#b388ff]/55 text-white active:scale-95 w-10 h-10 rounded-full flex items-center justify-center cursor-pointer transition-all duration-300 hover:scale-110`}
                title="পরবর্তী চ্যানেল"
              >
                <SkipForward size={16} />
              </button>

              <div className="w-[1px] h-6 bg-white/12 mx-1"></div>

              {/* Picture-in-Picture Button */}
              <button 
                onClick={togglePiP}
                className={`control-btn bg-white/10 hover:bg-[#00f2fe] border border-white/10 hover:border-[#00f2fe]/55 text-white active:scale-95 w-10 h-10 rounded-full flex items-center justify-center cursor-pointer transition-all duration-300 hover:scale-110 hover:shadow-[0_0_15px_rgba(0,242,254,0.45)]`}
                title="ভাসমান উইন্ডো উইজেট (Picture in Picture)"
              >
                <Smartphone size={16} />
              </button>

              <button 
                onClick={toggleFullscreen}
                className={`control-btn bg-white/10 hover:bg-[#b388ff] border border-white/10 hover:border-[#b388ff]/55 text-white active:scale-95 w-10 h-10 rounded-full flex items-center justify-center cursor-pointer transition-all duration-300 hover:scale-110`}
                title="ফুলস্ক্রিন"
              >
                <Maximize2 size={16} />
              </button>
            </div>
          </div>

          {/* Current Channel Info Card */}
          <div className={`media-details mt-[30px] bg-[#12121d]/60 border border-white/8 rounded-[20px] p-5 flex items-center gap-[15px] backdrop-blur-md shadow-lg ${viewMode === "3d" ? "neumorph-outset-dark border-none" : ""}`}>
            <div className={`channel-logo-wrapper w-16 h-16 rounded-[14px] bg-white p-1.5 flex items-center justify-center overflow-hidden flex-shrink-0 relative ${viewMode === "3d" ? "neumorph-inset-dark bg-white/5" : ""}`}>
              {currentChannel ? (
                currentChannel.logo ? (
                  <img 
                    src={currentChannel.logo} 
                    alt={currentChannel.name} 
                    className="max-w-full max-h-full object-contain rounded-[8px]"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = "none";
                      const sibling = e.currentTarget.parentElement?.querySelector(".avatar-fallback");
                      if (sibling) sibling.classList.remove("hidden");
                    }}
                  />
                ) : null
              ) : null}
              <div 
                className={`avatar-fallback w-full h-full flex items-center justify-center text-white rounded-[10px] font-display font-semibold uppercase text-md ${currentChannel && !currentChannel.logo ? "" : "hidden"}`}
                style={{
                  background: currentChannel ? getFallbackGradient(currentChannel.name) : "linear-gradient(135deg, #ff007f 0%, #9b51e0 100%)"
                }}
              >
                {currentChannel ? getInitials(currentChannel.name) : "📺"}
              </div>
            </div>

            <div className="current-channel-details flex flex-col gap-[3px] min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="live-badge bg-[#00ff87]/10 border border-[#00ff87]/30 text-[#00ff87] text-[10px] font-bold tracking-widest px-2 py-0.5 rounded-[30px] inline-flex items-center gap-1 uppercase">
                  <span className="live-dot w-1.5 h-1.5 rounded-full bg-[#00ff87] animate-[liveDotPulse_1.2s_infinite_alternate]"></span> LIVE
                </span>
                
                {/* Mobile view synced stats */}
                <div className="header-live-badge hidden max-md:flex items-center gap-2 bg-white/3 border border-white/8 py-0.5 px-[8px] rounded-[30px] text-[10px] font-semibold">
                  <div className="flex items-center gap-1 text-[#00ff87]">
                    <Eye size={10} /> {liveCount}
                  </div>
                  <div className="w-[1px] h-2.5 bg-white/12"></div>
                  <div className="flex items-center gap-1 text-[#00f2fe]">
                    <Smartphone size={10} /> {mobileCount}
                  </div>
                </div>
              </div>
              <h2 className="text-lg font-bold text-white tracking-tight overflow-hidden text-ellipsis whitespace-nowrap">
                {currentChannel ? currentChannel.name : "চ্যানেল সিলেক্ট করুন"}
              </h2>
              <p className="text-xs font-medium text-white/60 overflow-hidden text-ellipsis whitespace-nowrap font-display">
                {currentChannel ? currentChannel.categories.join(", ") : "M3U Stream Player"}
              </p>
            </div>
          </div>

          {/* Stats Bar (Bento-styled device stats dashboard) */}
          <div className={`stats-card mt-5 bg-[#12121d]/60 border border-white/8 rounded-[20px] p-4.5 flex flex-col gap-3 backdrop-blur-md shadow-lg max-md:hidden ${viewMode === "3d" ? "neumorph-outset-dark border-none" : ""}`}>
            <span className="text-[11px] font-bold tracking-wider text-white/40 uppercase mb-1 flex items-center gap-1.5 font-display"><Database size={11} /> রিয়েল-টাইম কানেক্টেড ডিভাইস স্ট্যাটস</span>
            <div className="grid grid-cols-3 gap-2.5">
              
              <div className="stat-box flex flex-col items-center justify-center p-2.5 rounded-xl bg-white/3 border border-white/4">
                <Eye size={14} className="text-[#00ff87] mb-1" />
                <span className="stat-count text-sm font-bold text-white tracking-tight font-display">
                  {liveCount}
                </span>
                <span className="text-[9px] text-white/50 text-center uppercase font-semibold">অ্যাক্টিভ ডিভাইস</span>
              </div>

              <div className="stat-box flex flex-col items-center justify-center p-2.5 rounded-xl bg-white/3 border border-white/4">
                <Smartphone size={14} className="text-[#00f2fe] mb-1" />
                <span className="stat-count text-sm font-bold text-white tracking-tight font-display">
                  {mobileCount}
                </span>
                <span className="text-[9px] text-white/50 text-center uppercase font-semibold">স্মার্টফোন</span>
              </div>

              <div className="stat-box flex flex-col items-center justify-center p-2.5 rounded-xl bg-white/3 border border-white/4">
                <Users size={14} className="text-[#ff007f] mb-1" />
                <span className="stat-count text-sm font-bold text-white tracking-tight font-display">
                  {totalCount}
                </span>
                <span className="text-[9px] text-white/50 text-center uppercase font-semibold">মোট ইউনিক ভিজিট</span>
              </div>

            </div>
          </div>

          {/* Info Banner for PiP tutorials */}
          <div className="mt-4 p-3 bg-white/3 border border-white/5 rounded-[15px] flex items-start gap-2.5 text-[11px] text-white/60 leading-relaxed font-primary">
            <Info size={14} className="text-[#00f2fe] flex-shrink-0 mt-0.5" />
            <p>
              <strong>ভাসমান পপ-আপ:</strong> ফ্লোটিং আইকনটিতে ক্লিক করুন, এরপর উইন্ডোটি যেকোনো জায়গায় ড্র্যাগ করে মোবাইল ও কম্পিউটারে অন্য কাজ করার সময়ও খেলা ও নাটক লাইভ দেখুন!
            </p>
          </div>

          {/* Left Footer Spacer */}
          <footer className="footer mt-auto text-xs text-white/40 text-center pt-5 border-t border-white/5 max-lg:hidden">
            © 2026 <span className="text-[#ff7a00] font-semibold">Live TV Channel Ltd</span>.
          </footer>
        </aside>

        {/* RIGHT SECTION: CATEGORIES, SEARCH, CHANNELS */}
        <main className="channels-section flex-1 flex flex-col lg:h-screen lg:overflow-y-auto">
          
          {/* Header Search Filtering sticky bar */}
          <div id="categories-search-section" className="search-filter-sticky sticky top-0 bg-[#07070a]/82 backdrop-blur-3xl p-6 lg:p-[30px] pb-5 z-8 border-b border-white/5">
            <div className="search-wrapper relative w-full mb-5">
              <span className="search-icon absolute left-5 top-1/2 -translate-y-1/2 text-lg text-white/60 pointer-events-none">
                <Search size={18} />
              </span>
              <input 
                type="text"
                placeholder="চ্যানেলের নাম দিয়ে ইনস্ট্যান্ট ফিল্টার করুন..."
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                className={`w-full py-4 pl-14 pr-12 rounded-[20px] bg-white/3 border border-white/8 text-white placeholder-white/40 outline-none transition-all duration-300 focus:border-[#00f2fe]/50 focus:bg-white/6 focus:shadow-[0_0_25px_rgba(0,242,254,0.15)] ${viewMode === "3d" ? "neumorph-inset-dark bg-[#0a0a0f]/45 border-none focus:shadow-[inset_6px_6px_14px_rgba(0,0,0,0.8),inset_-6px_-6px_14px_rgba(255,255,255,0.04),inset_0_0_0_1px_rgba(0,242,254,0.25)]" : ""}`}
              />
              {searchKeyword && (
                <button 
                  onClick={() => setSearchKeyword("")}
                  className="clear-search-btn absolute right-5 top-1/2 -translate-y-1/2 bg-none border-none text-white/50 hover:text-white p-[5px] rounded-full flex items-center justify-center cursor-pointer transition-colors duration-200"
                >
                  <X size={16} />
                </button>
              )}
            </div>

            {/* Dynamic Search History Chips */}
            {searchHistory.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 mt-2 mb-4 px-1 text-[11px] font-medium leading-normal select-none">
                <span className="text-white/40 font-semibold tracking-wide flex items-center gap-1">⌚ অতি সম্প্রতি খোঁজা:</span>
                <div className="flex flex-wrap items-center gap-1.5 flex-1">
                  {searchHistory.map((term, index) => (
                    <button
                      key={`${term}-${index}`}
                      onClick={() => setSearchKeyword(term)}
                      className="px-3 py-1 bg-white/5 hover:bg-white/10 hover:text-[#00f2fe] border border-white/8 text-white/70 rounded-full transition-all duration-200 cursor-pointer flex items-center gap-1 hover:scale-105 active:scale-95 text-[10px]"
                    >
                      <span className="text-white/30 text-[9px]">🔍</span>
                      <span>{term}</span>
                    </button>
                  ))}
                  <button
                    onClick={clearSearchHistory}
                    className="text-red-400/80 hover:text-red-400 text-[9px] ml-auto font-bold cursor-pointer transition-colors duration-150 p-1 hover:bg-red-500/10 rounded-lg"
                  >
                    হিস্ট্রি মুছুন (Clear)
                  </button>
                </div>
              </div>
            )}

            {/* Sweepable Categories List with Scroll Controls */}
            <div className="categories-wrapper relative w-full flex items-center pr-3">
              <div 
                ref={categoriesContainerRef}
                className="categories-container flex-1 overflow-x-auto select-none no-scrollbar flex scroll-smooth"
                style={{ scrollbarWidth: "none" }}
              >
                <div className="category-list flex gap-2.5 py-1 w-max pr-10">
                  {/* Favorites Category tab */}
                  <button 
                    onClick={() => setCurrentCategory("Favorites")}
                    className={`category-pill px-5 py-2.5 rounded-[50px] font-semibold text-sm cursor-pointer transition-all duration-300 font-display flex items-center gap-1.5 ${viewMode === "3d" ? "neumorph-outset-dark hover:scale-105 active:scale-100" : "bg-white/4 border border-white/8 hover:bg-white/8 hover:translate-y-[-1px]"} ${currentCategory === "Favorites" ? "bg-gradient-to-br from-[#ff007f] to-[#9b51e0] text-white border-none shadow-[0_0_20px_rgba(255,0,127,0.35)]" : "text-white/60 hover:text-white"}`}
                  >
                    <Star size={12} className="text-yellow-400" /> Favorites 
                    <span className="category-count text-[11px] ml-1 bg-white/10 px-2 py-0.5 rounded-full text-white/80 font-display">
                      {favorites.length}
                    </span>
                  </button>

                  {/* All channels Category tab */}
                  <button 
                    onClick={() => setCurrentCategory("All")}
                    className={`category-pill px-5 py-2.5 rounded-[50px] font-semibold text-sm cursor-pointer transition-all duration-300 font-display flex items-center gap-1.5 ${viewMode === "3d" ? "neumorph-outset-dark hover:scale-105 active:scale-100" : "bg-white/4 border border-white/8 hover:bg-white/8 hover:translate-y-[-1px]"} ${currentCategory === "All" ? "bg-gradient-to-br from-[#ff007f] to-[#9b51e0] text-white border-none shadow-[0_0_20px_rgba(255,0,127,0.35)]" : "text-white/60 hover:text-white"}`}
                  >
                    All Channels 
                    <span className="category-count text-[11px] ml-1 bg-white/10 px-2 py-0.5 rounded-full text-white/80 font-display">
                      {channels.length}
                    </span>
                  </button>

                  {/* ADMIN CONTROL PANEL category pill */}
                  {isAdminAuthenticated && (
                    <button 
                      onClick={() => setCurrentCategory("Manage")}
                      className={`category-pill px-5 py-2.5 rounded-[50px] font-semibold text-sm cursor-pointer transition-all duration-300 font-display flex items-center gap-1.5 glow-cyan-pulse ${viewMode === "3d" ? "neumorph-outset-dark hover:scale-105 active:scale-100" : "bg-white/4 border border-white/8 hover:bg-white/8 hover:translate-y-[-1px]"} ${currentCategory === "Manage" ? "bg-gradient-to-br from-[#00f2fe] to-[#9b51e0] text-white border-none shadow-[0_0_20px_rgba(0,242,254,0.35)]" : "text-white/60 hover:text-[#00f2fe]"}`}
                    >
                      <Sparkles size={12} className="text-[#00f2fe] animate-pulse" /> 🛠️ প্লেলিস্ট ও চ্যানেল ম্যানেজার (Admin Mode)
                    </button>
                  )}

                  {isAdminAuthenticated && (
                    <button 
                      onClick={() => {
                        setAdminPassword("");
                        localStorage.removeItem("adminPassword");
                        setCurrentCategory("All");
                        setSuccessMsg("সফলভাবে লগআউট করা হয়েছে!");
                      }}
                      className="category-pill px-4 py-2.5 rounded-[50px] font-semibold text-xs cursor-pointer transition-all duration-300 bg-red-500/10 hover:bg-red-500 hover:text-white border border-red-500/20 text-red-400 hover:scale-105 active:scale-95 flex items-center gap-1.5 font-display"
                      title="এডমিন লগআউট করুন"
                    >
                      🔒 লগআউট
                    </button>
                  )}

                  {/* Individual Categories list mapping */}
                  {categories.map((cat) => {
                    const count = channels.filter((ch) => ch.categories.includes(cat)).length;
                    return (
                      <button 
                        key={cat}
                        onClick={() => setCurrentCategory(cat)}
                        className={`category-pill px-5 py-2.5 rounded-[50px] font-semibold text-sm cursor-pointer transition-all duration-300 font-display flex items-center gap-1.5 ${viewMode === "3d" ? "neumorph-outset-dark hover:scale-105 active:scale-100" : "bg-white/4 border border-white/8 hover:bg-white/8 hover:translate-y-[-1px]"} ${currentCategory === cat ? "bg-gradient-to-br from-[#ff007f] to-[#9b51e0] text-white border-none shadow-[0_0_20px_rgba(255,0,127,0.35)]" : "text-white/60 hover:text-white"}`}
                      >
                        {cat}
                        <span className="category-count text-[11px] ml-1 bg-white/10 px-2 py-0.5 rounded-full text-white/80 font-display">
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Scroll controller Indicators */}
              <button 
                onClick={() => scrollCategories("left")}
                className={`scroll-indicator scroll-left absolute left-1 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/8 hover:bg-[#b388ff] border border-white/10 hover:border-[#b388ff] text-white flex items-center justify-center text-xs shadow-lg cursor-pointer transition-all duration-300 hover:scale-115 ${viewMode === "3d" ? "neumorph-outset-dark border-none" : ""}`}
                title="Scroll Left"
              >
                <ChevronLeft size={14} />
              </button>
              <button 
                onClick={() => scrollCategories("right")}
                className={`scroll-indicator scroll-right absolute right-1 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/8 hover:bg-[#b388ff] border border-white/10 hover:border-[#b388ff] text-white flex items-center justify-center text-xs shadow-lg cursor-pointer transition-all duration-300 hover:scale-115 ${viewMode === "3d" ? "neumorph-outset-dark border-none" : ""}`}
                title="Scroll Right"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>

          {/* Grid Layout of Channels */}
          <div className="channels-grid-wrapper flex-1 p-6 lg:p-[30px] pb-10">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-20 gap-4">
                <div className="spinner w-10 h-10 border-3 border-[#00f2fe]/10 border-t-[#00f2fe] border-r-[#ff007f] rounded-full animate-spin"></div>
                <p className="text-white/50 text-sm font-display tracking-wider font-semibold uppercase">লোড হচ্ছে...</p>
              </div>
            ) : currentCategory === "Manage" ? (
              /* DYNAMICAL CHANNEL MANAGEMENT & M3U UPLOADER DASHBOARD */
              <motion.div 
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                className="admin-dashboard-container flex flex-col gap-8 text-left"
              >
                <div className="flex flex-col gap-2">
                  <h2 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-2">
                    <Sparkles className="text-[#00f2fe]" /> চ্যানেল ও প্লেলিস্ট ম্যানেজমেন্ট প্যানেল
                  </h2>
                  <p className="text-sm text-white/60 leading-relaxed font-primary">
                    খুব সহজেই নতুন চ্যানেল যোগ করুন, আপনার M3U ফাইল সরাসরি ইম্পোর্ট করে ক্যাটেগরি সাজান অথবা ডাটাবেজ থেকে যেকোনো চ্যানেল মুছে দিন। এটি সরাসরি লোকালহোস্ট ডেটাবেজে (<code className="bg-white/10 px-1 rounded text-xs select-all">channels-db.json</code>) আপডেট হয়ে সেভ থাকে।
                  </p>
                </div>

                {/* Success & Error alerts banner */}
                {(successMsg || adminError) && (
                  <div className="rounded-xl p-4 border flex flex-col gap-1 transition-all">
                    {successMsg && (
                      <div className="flex items-start gap-2.5 text-[#00ff87] bg-[#00ff8 green]/10">
                        <CheckCircle size={18} className="flex-shrink-0 mt-0.5" />
                        <p className="text-sm font-semibold">{successMsg}</p>
                      </div>
                    )}
                    {adminError && (
                      <div className="flex items-start gap-2.5 text-red-500 bg-red-500/10">
                        <AlertTriangle size={18} className="flex-shrink-0 mt-0.5" />
                        <p className="text-sm font-semibold">{adminError}</p>
                      </div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-7">
                  {/* Form Component: Add Dynamic Channel */}
                  <div className={`p-6 bg-[#12121d]/60 border border-white/8 rounded-3xl ${viewMode === "3d" ? "neumorph-outset-dark border-none" : ""}`}>
                    <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2 border-b border-white/5 pb-2">
                      <Plus className="text-[#00ff87]" /> ১. নতুন সিঙ্গেল চ্যানেল যোগ করুন
                    </h3>

                    <form onSubmit={handleAddNewChannel} className="flex flex-col gap-4 font-semibold text-sm">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs text-white/50 tracking-wider">চ্যানেলের নাম (চ্যানেল টাইটেল)</label>
                        <input 
                          type="text" 
                          placeholder="উদা: Somoy TV HD, Channel 9" 
                          value={newChanName}
                          onChange={(e) => setNewChanName(e.target.value)}
                          className="px-4 py-3 bg-white/4 border border-white/8 rounded-xl text-white outline-none w-full"
                          required
                        />
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs text-white/50 tracking-wider">এইচডি ভিডিও স্ট্রিম URL (.m3u8 বা .ts টাইপ)</label>
                        <input 
                          type="url" 
                          placeholder="উদা: https://domain/live/stream/index.m3u8" 
                          value={newChanUrl}
                          onChange={(e) => setNewChanUrl(e.target.value)}
                          className="px-4 py-3 bg-white/4 border border-white/8 rounded-xl text-white outline-none w-full font-mono text-xs"
                          required
                        />
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs text-white/50 tracking-wider">চ্যানেল লোগো ইমেজ লিঙ্ক (ঐচ্ছিক)</label>
                        <input 
                          type="url" 
                          placeholder="উদা: https://logo-domain/rtv-logo.png" 
                          value={newChanLogo}
                          onChange={(e) => setNewChanLogo(e.target.value)}
                          className="px-4 py-3 bg-white/4 border border-white/8 rounded-xl text-white outline-none w-full"
                        />
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs text-white/50 tracking-wider">ক্যাটেগরি (ভিডিওর ধরণ নির্ধারণ করুন)</label>
                        <select 
                          value={newChanCategory} 
                          onChange={(e) => setNewChanCategory(e.target.value)}
                          className="px-4 py-3 bg-neutral-900 border border-white/8 rounded-xl text-white outline-none w-full"
                        >
                          <option value="Bangla">Bangla (বাংলাদেশী চ্যানেল)</option>
                          <option value="News">News (সংবাদ চ্যানেল)</option>
                          <option value="Entertainment">Entertainment (বিনোদন)</option>
                          <option value="Sports">Sports (খেলাধুলা লাইভ)</option>
                          <option value="Indian Bangla">Indian Bangla</option>
                          <option value="Kids">Kids (কার্টুন ও মাস্তি)</option>
                          <option value="English">English</option>
                          <option value="Movies">Movies</option>
                          <option value="Religious">Religious</option>
                          <option value="Other">Other (অন্যান্য)</option>
                        </select>
                      </div>

                      <button 
                        type="submit"
                        className="w-full mt-2 py-3.5 bg-gradient-to-br from-[#00ff87] to-[#00f2fe] text-[#07070a] rounded-xl font-bold hover:scale-[1.02] active:scale-95 duration-200 shadow-[0_4px_15px_rgba(0,255,135,0.25)] cursor-pointer"
                      >
                        চ্যানেল যুক্ত ও সেভ করুন
                      </button>
                    </form>
                  </div>

                  {/* Form Component: Paste M3U Document Text */}
                  <div className={`p-6 bg-[#12121d]/60 border border-white/8 rounded-3xl ${viewMode === "3d" ? "neumorph-outset-dark border-none" : ""}`}>
                    <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2 border-b border-white/5 pb-2">
                      <Upload className="text-[#00f2fe]" /> ২. সম্পূর্ণ M3U প্লেলিস্ট সরাসরি ইম্পোর্ট করুন
                    </h3>

                    <form onSubmit={handleImportM3UPlaylist} className="flex flex-col gap-4 font-semibold text-sm">
                      <div className="flex flex-col gap-1 flex-1">
                        <label className="text-xs text-white/50 tracking-wider mb-1">
                          যেকোনো M3U ডকুমেন্টের টেক্সট সরাসরি নিচে পেস্ট করুন (যেমন: ntv-bd-channels.m3u ইত্যাদি):
                        </label>
                        <textarea 
                          placeholder={`#EXTM3U\n#EXTINF:-1 tvg-logo="https://..." group-title="Sports",T Sports HD\nhttps://stream-url/output.m3u8`} 
                          value={m3uPasteText}
                          onChange={(e) => setM3uPasteText(e.target.value)}
                          className="px-4 py-3 bg-white/4 border border-white/8 rounded-xl text-white outline-none w-full h-[180px] font-mono text-[11px] leading-relaxed resize-none"
                          required
                        />
                      </div>

                      <div className="flex flex-col gap-2">
                        <span className="text-xs text-white/50 tracking-wider">ইম্পোর্ট অপশন:</span>
                        <div className="flex gap-4">
                          <label className="flex items-center gap-2 cursor-pointer text-white text-xs">
                            <input 
                              type="radio" 
                              name="importMode" 
                              checked={m3uImportMode === "merge"} 
                              onChange={() => setM3uImportMode("merge")}
                              className="accent-[#00f2fe]"
                            />
                            বিদ্যমান তালিকার সাথে যোগ করুন
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer text-white text-xs">
                            <input 
                              type="radio" 
                              name="importMode" 
                              checked={m3uImportMode === "replace"} 
                              onChange={() => setM3uImportMode("replace")}
                              className="accent-[#ff007f]"
                            />
                            আগের সব চ্যানেল মুছে রি-প্লেস করুন
                          </label>
                        </div>
                      </div>

                      <button 
                        type="submit"
                        className="w-full py-3.5 bg-gradient-to-br from-[#00f2fe] to-[#9b51e0] text-white rounded-xl font-bold hover:scale-[1.02] active:scale-95 duration-200 shadow-[0_4px_15px_rgba(0,242,254,0.25)] cursor-pointer"
                      >
                        M3U প্লেলিস্ট ইম্পোর্ট করুন
                      </button>
                    </form>
                  </div>
                </div>

                {/* Directory Management: List / Remove Individual Channels */}
                <div className={`p-6 bg-[#12121d]/60 border border-white/8 rounded-3xl ${viewMode === "3d" ? "neumorph-outset-dark border-none" : ""}`}>
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-white/5 pb-3 mb-4">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                      <Database className="text-[#ff007f]" /> ৩. ডাটাবেজে সংরক্ষিত চ্যানেলের ডিরেক্টরি ({channels.length} টি)
                    </h3>
                    
                    {showRestoreConfirm ? (
                      <div className="flex items-center gap-2 bg-red-500/10 p-2 rounded-xl border border-red-500/20 text-[11px] font-semibold">
                        <span className="text-white font-medium">নিশ্চিত রিস্টোর করবেন?</span>
                        <button 
                          onClick={() => {
                            setChannels(FALLBACK_CHANNELS);
                            playChannelByIndex(0, FALLBACK_CHANNELS);
                            setSuccessMsg("ডিফল্ট চ্যানেল তালিকা সফলভাবে রিলোড করা হয়েছে এবং ডাটাবেজ আপডেট হয়েছে!");
                            setShowRestoreConfirm(false);
                          }}
                          className="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white rounded-lg cursor-pointer transition"
                        >
                          হ্যাঁ
                        </button>
                        <button 
                          onClick={() => setShowRestoreConfirm(false)}
                          className="px-2.5 py-1 bg-white/10 hover:bg-white/20 text-white rounded-lg cursor-pointer transition"
                        >
                          বাতিল
                        </button>
                      </div>
                    ) : (
                      <button 
                        onClick={() => setShowRestoreConfirm(true)}
                        className="px-4 py-1.5 bg-white/5 hover:bg-[#ff007f]/15 text-white hover:text-[#ff007f] text-xs font-semibold rounded-lg border border-white/8 active:scale-95 duration-200 cursor-pointer"
                      >
                        ডিফল্ট চ্যানেল রিস্টোর করুন
                      </button>
                    )}
                  </div>

                  {/* Quick Admin Search Filter in database */}
                  <input 
                    type="text" 
                    placeholder="ডাটাবেজ চ্যানেল থেকে মুছতে সার্চ করুন..." 
                    value={searchKeyword}
                    onChange={(e) => setSearchKeyword(e.target.value)}
                    className="w-full px-4 py-2.5 bg-white/4 border border-white/8 rounded-xl text-xs text-white mb-4 outline-none"
                  />

                  {/* Bulk Actions Panel with clean custom glassmorphic warning style */}
                  {selectedChannels.length > 0 && (
                    <motion.div 
                      initial={{ opacity: 0, y: -10, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -10, scale: 0.98 }}
                      className="p-4 mb-4 bg-red-500/10 border border-red-500/25 rounded-2xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shadow-[0_0_20px_rgba(239,68,68,0.12)] transition-all duration-300"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-red-500/20 flex items-center justify-center text-red-400 shrink-0 select-none animate-pulse">
                          <Trash2 size={16} />
                        </div>
                        <div>
                          <h4 className="text-xs font-bold text-white flex items-center gap-1.5 leading-none">
                            বাল্ক অ্যাকশন (Bulk Action) সক্রিয়
                          </h4>
                          <p className="text-[11px] text-white/50 mt-1">
                            আপনি ডিরেক্টরি থেকে একসাথে মুছে ফেলার জন্য <span className="text-red-400 font-bold px-1 bg-red-500/15 rounded text-sm">{selectedChannels.length}</span> টি চ্যানেল সিলেক্ট করেছেন।
                          </p>
                        </div>
                      </div>

                      {showBulkDeleteConfirm ? (
                        <div className="flex items-center gap-2 bg-red-600/20 p-2 rounded-xl border border-red-500/30 text-[11px] w-full sm:w-auto justify-end">
                          <span className="text-red-200 font-bold mr-1">নিশ্চিত মুছে ফেলবেন?</span>
                          <button 
                            onClick={handleDeleteMultipleChannels}
                            className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold cursor-pointer transition text-[10px] flex items-center gap-1"
                          >
                            হ্যাঁ, ডিলিট করুন
                          </button>
                          <button 
                            onClick={() => setShowBulkDeleteConfirm(false)}
                            className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg cursor-pointer transition text-[10px]"
                          >
                            বাতিল
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 w-full sm:w-auto shrink-0 select-none">
                          <button 
                            onClick={() => setShowBulkDeleteConfirm(true)}
                            className="w-full sm:w-auto px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl active:scale-95 duration-200 shadow-[0_4px_12px_rgba(239,68,68,0.25)] cursor-pointer text-[11px] flex items-center justify-center gap-1.5"
                          >
                            <Trash2 size={12} /> নির্বাচিত {selectedChannels.length} টি ডিলিট করুন
                          </button>
                          <button 
                            onClick={() => {
                              setSelectedChannels([]);
                              setShowBulkDeleteConfirm(false);
                            }}
                            className="w-full sm:w-auto px-4 py-2 bg-white/5 hover:bg-white/10 text-white/80 rounded-xl active:scale-95 duration-200 border border-white/10 cursor-pointer text-[11px] flex items-center justify-center gap-1.5"
                          >
                            নির্বাচন বাতিল করুন
                          </button>
                        </div>
                      )}
                    </motion.div>
                  )}

                  <div className="max-h-[300px] overflow-y-auto pr-1 no-scrollbar border border-white/5 rounded-xl">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-white/5 text-white/50 font-bold border-b border-white/8">
                          <th className="p-3 w-10 text-center">
                            <input 
                              type="checkbox"
                              checked={filteredChannels.length > 0 && filteredChannels.every(item => selectedChannels.includes(item.url))}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  const visibleUrls = filteredChannels.map(item => item.url);
                                  setSelectedChannels(prev => {
                                    const newSelection = [...prev];
                                    visibleUrls.forEach(url => {
                                      if (!newSelection.includes(url)) {
                                        newSelection.push(url);
                                      }
                                    });
                                    return newSelection;
                                  });
                                } else {
                                  const visibleUrlsSet = new Set(filteredChannels.map(item => item.url));
                                  setSelectedChannels(prev => prev.filter(url => !visibleUrlsSet.has(url)));
                                }
                              }}
                              className="rounded bg-white/10 border-white/20 text-[#00f2fe] focus:ring-0 accent-[#00f2fe] cursor-pointer"
                            />
                          </th>
                          <th className="p-3">লোগো</th>
                          <th className="p-3">চ্যানেলের নাম</th>
                          <th className="p-3">ক্যাটেগরি</th>
                          <th className="p-3">স্ট্রিমিং লিংক (URL)</th>
                          <th className="p-3 text-right">পদক্ষেপ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredChannels.length > 0 ? (
                          filteredChannels.map((item, index) => {
                            const isSelected = selectedChannels.includes(item.url);
                            return (
                              <tr 
                                key={`${item.url}-${index}`} 
                                className={`border-b border-white/4 font-medium transition-colors cursor-pointer ${isSelected ? "bg-[#ff007f]/5 hover:bg-[#ff007f]/8" : "hover:bg-white/3"}`}
                                onClick={() => {
                                  if (selectedChannels.includes(item.url)) {
                                    setSelectedChannels(prev => prev.filter(url => url !== item.url));
                                  } else {
                                    setSelectedChannels(prev => [...prev, item.url]);
                                  }
                                }}
                              >
                                <td className="p-3 w-10 text-center select-none" onClick={(e) => e.stopPropagation()}>
                                  <input 
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setSelectedChannels(prev => [...prev, item.url]);
                                      } else {
                                        setSelectedChannels(prev => prev.filter(url => url !== item.url));
                                      }
                                    }}
                                    className="rounded bg-white/10 border-white/20 text-[#00f2fe] focus:ring-0 accent-[#00f2fe] cursor-pointer"
                                  />
                                </td>
                                <td className="p-3" onClick={(e) => e.stopPropagation()}>
                                  <div className="w-8 h-8 rounded bg-white flex items-center justify-center p-0.5 overflow-hidden">
                                    {item.logo ? (
                                      <img src={item.logo} alt="" className="max-w-full max-h-full object-contain" />
                                    ) : (
                                      <span className="text-[10px]">📺</span>
                                    )}
                                  </div>
                                </td>
                                <td className="p-3 text-white font-bold">{item.name}</td>
                                <td className="p-3">
                                  <span className="px-2 py-0.5 rounded bg-white/10 text-white/70">{item.categories.join(", ")}</span>
                                </td>
                                <td className="p-3 font-mono text-[10px] text-white/40 max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap" title={item.url}>
                                  {item.url}
                                </td>
                                <td className="p-3 text-right text-right" onClick={(e) => e.stopPropagation()}>
                                  {pendingDeleteUrl === item.url ? (
                                    <div className="flex gap-1 items-center justify-end">
                                      <button 
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleDeleteChannel(item.url, item.name);
                                          setPendingDeleteUrl(null);
                                        }}
                                        className="px-2 py-0.5 bg-red-600 hover:bg-red-700 text-white rounded text-[9px] font-bold duration-150 cursor-pointer"
                                      >
                                        হ্যাঁ
                                      </button>
                                      <button 
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setPendingDeleteUrl(null);
                                        }}
                                        className="px-2 py-0.5 bg-white/10 hover:bg-white/25 text-white/80 rounded text-[9px] duration-150 cursor-pointer"
                                      >
                                        বাতিল
                                      </button>
                                    </div>
                                  ) : (
                                    <button 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setPendingDeleteUrl(item.url);
                                      }}
                                      className="p-1.5 bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white rounded-lg cursor-pointer hover:scale-110 active:scale-95 duration-200"
                                      title="মুছে ফেলুন"
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        ) : (
                          <tr>
                            <td colSpan={6} className="p-6 text-center text-white/40 font-semibold text-xs">কোনো চ্যানেল খুঁজে পাওয়া যায়নি!</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

              </motion.div>
            ) : filteredChannels.length > 0 ? (
              <div className="channel-grid grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6 gap-5 animate-grid-entrance">
                {filteredChannels.map((ch, idx) => {
                  const isActive = currentChannel && currentChannel.url === ch.url;
                  const isFav = favorites.includes(ch.url);
                  return (
                    <div 
                      key={`${ch.url}-${idx}`}
                      onClick={() => playChannelByIndex(idx, filteredChannels)}
                      className={`channel aspect-square rounded-[20px] p-4 flex flex-col justify-center items-center cursor-pointer duration-300 relative overflow-hidden group select-none hover:scale-105 active:scale-95 transition-all text-center ${viewMode === "3d" ? "neumorph-outset-dark hover:shadow-[10px_10px_20px_rgba(0,0,0,0.75),-10px_-10px_20px_rgba(255,255,255,0.05)] border-none" : "bg-[#12121d]/60 border border-white/8 hover:bg-[#1a1a2a]/85 hover:border-transparent hover:shadow-[0_15px_30px_rgba(0,0,0,0.4),0_0_15px_rgba(255,0,127,0.12)]"} ${isActive ? "border-transparent bg-[#1a1a2a]/85 shadow-[0_0_35px_rgba(255,0,127,0.4),inset_0_0_10px_rgba(255,0,127,0.2)]" : ""}`}
                    >
                      {/* Active Border Glow Ring overlay */}
                      <div className={`absolute top-0 left-0 right-0 bottom-0 rounded-[20px] p-[1px] bg-gradient-to-br from-[#ff007f] to-[#9b51e0] transition-opacity duration-300 pointer-events-none ${isActive ? "opacity-80" : "opacity-0 group-hover:opacity-45"}`}></div>

                      {/* Bookmark button */}
                      <button 
                        onClick={(e) => toggleFavorite(e, ch.url)}
                        className={`fav-btn absolute top-3 right-3 rounded-full w-7 h-7 flex items-center justify-center text-xs cursor-pointer z-5 transition-all duration-300 scale-90 ${viewMode === "3d" ? "bg-white/2 border-none neumorph-outset-dark hover:bg-yellow-400/5" : "bg-white/4 border border-white/8 hover:bg-yellow-400/10 hover:border-yellow-400/20"} ${isFav ? "bg-yellow-400/15 border-yellow-400/40 text-yellow-500 shadow-[0_0_10px_rgba(255,204,0,0.45)]" : "text-white/60 hover:text-yellow-400"}`}
                      >
                        <Star size={11} fill={isFav ? "#eab308" : "none"} stroke={isFav ? "#eab308" : "currentColor"} />
                      </button>

                      <div className="w-full h-full flex flex-col items-center justify-center">
                        {ch.logo ? (
                          <img 
                            src={ch.logo} 
                            alt={ch.name} 
                            className="w-[80%] h-[80%] object-contain rounded-[10px] filter drop-shadow-md transition-transform duration-300 group-hover:scale-108"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.display = "none";
                              const fallbackDiv = e.currentTarget.parentElement?.querySelector(".fallback-block");
                              if (fallbackDiv) fallbackDiv.classList.remove("hidden");
                            }}
                          />
                        ) : null}

                        <div className={`fallback-block flex flex-col items-center justify-center gap-2 text-center w-full h-full ${ch.logo ? "hidden" : ""}`}>
                          <div 
                            className="w-12 h-12 rounded-[12px] flex items-center justify-center text-white font-display font-semibold text-lg text-white"
                            style={{ background: getFallbackGradient(ch.name) }}
                          >
                            {getInitials(ch.name)}
                          </div>
                          <div className="text-white/80 font-semibold text-[11px] overflow-hidden text-ellipsis whitespace-nowrap w-full px-1">
                            {ch.name}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="no-results-msg flex flex-col items-center justify-center gap-4 py-20 text-center">
                <span className="text-5xl animate-[floatEmoji_3s_ease-in-out_infinite_alternate]">📺</span>
                <p className="text-white/60 text-base font-semibold max-w-sm leading-relaxed">
                  {currentCategory === "Favorites" 
                    ? "আপনার বুকমার্ক করা পছন্দের কোনো চ্যানেল পাওয়া যায়নি। প্রিয় চ্যানেলগুলো সংরক্ষণ করতে চ্যানেল কার্ডের উপরে অবস্থিত স্টার বাটনে ক্লিক করুন।" 
                    : "আপনার খোঁজা নামের কোনো লাইভ চ্যানেল পাওয়া যায়নি। অনুগ্রহ করে অন্য কিওয়ার্ড ট্রাই করুন।"
                  }
                </p>
              </div>
            )}

            {/* MAIN BOTTOM FOOTER */}
            <footer className={`main-footer mt-[50px] bg-[#12121d]/60 border border-white/8 rounded-[24px] p-10 lg:p-[45px] pb-7 backdrop-blur-md shadow-2xl font-poppins transition-all duration-300 hover:border-white/15 ${viewMode === "3d" ? "neumorph-outset-dark border-none hover:shadow-[12px_12px_30px_rgba(0,0,0,0.75)]" : ""}`}>
              <div className="footer-grid grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-10 mb-10 text-left">
                {/* Brand About Column */}
                <div className="footer-col flex flex-col">
                  <div className="footer-logo-container flex items-center gap-3 mb-[18px]">
                    <span className="brand-logo text-3xl">📺</span>
                    <span className="logo font-poppins font-extrabold text-2xl uppercase logo-shimmer">Live TV <span>Channel</span></span>
                  </div>
                  <p className="footer-desc text-white/60 text-sm leading-relaxed mb-6 font-primary">
                    লাইভ টিভি চ্যানেল আপনার প্রিমিয়াম লাইভ টেলিভিশন এন্টারটেইনমেন্ট সলিউশন। বিনোদন, খেলাধুলা, খবর, মুভি এবং ইসলামিক আলোচনা সহ দেশে এবং বিদেশের সকল জনপ্রিয় টিভি চ্যানেল উপভোগ করুন ঝামেলা ছাড়াই।
                  </p>
                  
                  {/* Social lists */}
                  <div className="footer-socials flex items-center flex-wrap gap-2.5">
                    <a href="https://www.facebook.com/shahriar.thebrowncat" target="_blank" className="social-btn facebook bouncy-social bg-white w-9.5 h-9.5 flex items-center justify-center rounded-full text-[#1877F2] shadow-md hover:scale-125 hover:translate-y-[-6px]"><i className="fa-brands fa-facebook"></i></a>
                    <a href="https://t.me/Shariar_Ahamed" target="_blank" className="social-btn telegram bouncy-social bg-white w-9.5 h-9.5 flex items-center justify-center rounded-full text-[#0088CC] shadow-md hover:scale-125 hover:translate-y-[-6px]"><i className="fa-brands fa-telegram"></i></a>
                    <a href="https://instagram.com/shahriar_thebrowncat" target="_blank" className="social-btn instagram bouncy-social bg-white w-9.5 h-9.5 flex items-center justify-center rounded-full text-[#c13584] shadow-md hover:scale-125 hover:translate-y-[-6px]"><i className="fa-brands fa-instagram"></i></a>
                    <a href="https://twitter.com/ShariarAlways" target="_blank" className="social-btn twitter bouncy-social bg-white w-9.5 h-9.5 flex items-center justify-center rounded-full text-[#1DA1F2] shadow-md hover:scale-125 hover:translate-y-[-6px]"><i className="fa-brands fa-twitter"></i></a>
                    <a href="https://linkedin.com/in/shariarahamed" target="_blank" className="social-btn linkedin bouncy-social bg-white w-9.5 h-9.5 flex items-center justify-center rounded-full text-[#0077B5] shadow-md hover:scale-125 hover:translate-y-[-6px]"><i className="fa-brands fa-linkedin"></i></a>
                    <a href="https://github.com/Shariar-Ahamed" target="_blank" className="social-btn github bouncy-social bg-white w-9.5 h-9.5 flex items-center justify-center rounded-full text-[#181717] shadow-md hover:scale-125 hover:translate-y-[-6px]"><i className="fa-brands fa-github"></i></a>
                  </div>
                </div>

                {/* Quick Links Column */}
                <div className="footer-col flex flex-col">
                  <h3 className="footer-col-title text-white font-bold text-base uppercase relative pb-2.5 mb-6">👁️ Quick Links</h3>
                  <ul className="footer-links flex flex-col gap-3 font-semibold text-sm">
                    <li><a href="#" onClick={resetToDefaultApp} className="footer-link text-white/60 hover:text-[#00f2fe] flex items-center gap-2 hover:translate-x-1 duration-200"><i className="fa-solid fa-chevron-right text-[10px]"></i> Home Live</a></li>
                    <li><a href="#" onClick={scrollToCategories} className="footer-link text-white/60 hover:text-[#00f2fe] flex items-center gap-2 hover:translate-x-1 duration-200"><i className="fa-solid fa-chevron-right text-[10px]"></i> Categories list</a></li>
                    <li><a href="#" onClick={(e) => { e.preventDefault(); setActiveModal("privacy"); }} className="footer-link text-white/60 hover:text-[#00f2fe] flex items-center gap-2 hover:translate-x-1 duration-200"><i className="fa-solid fa-chevron-right text-[10px]"></i> Privacy Policy</a></li>
                    <li><a href="#" onClick={(e) => { e.preventDefault(); setActiveModal("terms"); }} className="footer-link text-white/60 hover:text-[#00f2fe] flex items-center gap-2 hover:translate-x-1 duration-200"><i className="fa-solid fa-chevron-right text-[10px]"></i> Terms of Service</a></li>
                    <li><a href="#" onClick={(e) => { e.preventDefault(); setActiveModal("disclaimer"); }} className="footer-link text-white/60 hover:text-[#00f2fe] flex items-center gap-2 hover:translate-x-1 duration-200"><i className="fa-solid fa-chevron-right text-[10px]"></i> Disclaimer rules</a></li>
                  </ul>
                </div>

                {/* Categories Shortcut Column */}
                <div className="footer-col flex flex-col">
                  <h3 className="footer-col-title text-white font-bold text-base uppercase relative pb-2.5 mb-6">📺 TV Categories</h3>
                  <ul className="footer-links flex flex-col gap-3 font-semibold text-sm">
                    <li><a href="#" onClick={(e) => handleFooterCatClick(e, "News")} className="footer-link text-white/60 hover:text-[#00f2fe] flex items-center gap-2 hover:translate-x-1 duration-200"><i className="fa-solid fa-tv text-[11px]"></i> News Bangla</a></li>
                    <li><a href="#" onClick={(e) => handleFooterCatClick(e, "Entertainment")} className="footer-link text-white/60 hover:text-[#00f2fe] flex items-center gap-2 hover:translate-x-1 duration-200"><i className="fa-solid fa-tv text-[11px]"></i> Entertainment</a></li>
                    <li><a href="#" onClick={(e) => handleFooterCatClick(e, "Sports")} className="footer-link text-white/60 hover:text-[#00f2fe] flex items-center gap-2 hover:translate-x-1 duration-200"><i className="fa-solid fa-tv text-[11px]"></i> Sports Live</a></li>
                    <li><a href="#" onClick={(e) => handleFooterCatClick(e, "Movies")} className="footer-link text-white/60 hover:text-[#00f2fe] flex items-center gap-2 hover:translate-x-1 duration-200"><i className="fa-solid fa-tv text-[11px]"></i> Hindi Movies</a></li>
                    <li><a href="#" onClick={(e) => handleFooterCatClick(e, "Kids")} className="footer-link text-white/60 hover:text-[#00f2fe] flex items-center gap-2 hover:translate-x-1 duration-200"><i className="fa-solid fa-tv text-[11px]"></i> Cartoon Kids</a></li>
                  </ul>
                </div>

                {/* Contact Info Column */}
                <div className="footer-col flex flex-col">
                  <h3 className="footer-col-title text-white font-bold text-base uppercase relative pb-2.5 mb-6">📞 Contact Info</h3>
                  <ul className="footer-contact-list flex flex-col gap-4 font-semibold text-sm">
                    <li className="flex items-start gap-3">
                      <i className="fa-solid fa-envelope text-[#EA4335] text-base mt-[3px] filter drop-shadow-md"></i>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] text-white/40 uppercase tracking-widest font-display">Email Support</span>
                        <a href="mailto:shariaralways@gmail.com" className="text-white hover:text-[#EA4335] duration-200">shariaralways@gmail.com</a>
                      </div>
                    </li>
                    <li className="flex items-start gap-3">
                      <i className="fa-solid fa-globe text-[#00A2FF] text-base mt-[3px] filter drop-shadow-md"></i>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] text-white/40 uppercase tracking-widest font-display">Official Web</span>
                        <a href="https://www.ripon.engineer/" target="_blank" className="text-white hover:text-[#00A2FF] duration-200 font-display">www.ripon.engineer</a>
                      </div>
                    </li>
                    <li className="flex items-start gap-3">
                      <i className="fa-brands fa-telegram text-[#0088CC] text-base mt-[3px] filter drop-shadow-md"></i>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] text-white/40 uppercase tracking-widest font-display font-display">Telegram Tech</span>
                        <a href="https://t.me/Shariar_Ahamed" target="_blank" className="text-white hover:text-[#0088CC] duration-200">@Shariar_Ahamed</a>
                      </div>
                    </li>
                  </ul>
                </div>
              </div>

              {/* Developer branding lines */}
              <div className="footer-bottom border-t border-white/5 pt-6 flex flex-col sm:flex-row items-center justify-between gap-5 text-sm text-white/40 mb-2">
                <div>
                  © 2026 <span className="text-[#ff7a00] font-semibold text-shadow">Live TV Channel</span>. All rights reserved.
                </div>
                <div>
                  Designed & Developed with <span className="text-[#ff007f] animate-[heartBeat_1.5s_infinite_alternate_ease-in-out] inline-block mx-1">❤️</span> by{" "}
                  <span 
                    onClick={() => {
                      setLoginInputWord("");
                      setLoginError("");
                      setActiveModal("adminLogin");
                    }} 
                    className="text-white hover:text-[#00f2fe] duration-200 font-semibold text-shadow cursor-pointer border-b border-dashed border-white/30 hover:border-[#00f2fe]"
                    title="এডমিন লগইন করতে ক্লিক করুন"
                  >
                    Mahbubur Rahman Shaon
                  </span>
                </div>
              </div>
            </footer>
          </div>
        </main>
      </div>

      {/* POPUP MODAL DIALOGS */}
      {activeModal && (
        <div className="custom-modal fixed top-0 left-0 w-full h-full z-50 flex items-center justify-center opacity-100 visible transition-all duration-300">
          <div className="custom-modal-overlay absolute top-0 left-0 w-full h-full bg-[#07070c]/65 backdrop-blur-md" onClick={() => setActiveModal(null)}></div>
          <div className="custom-modal-card relative w-[90%] max-w-[500px] bg-[#12121d]/85 backdrop-blur-2xl border border-white/8 rounded-[28px] p-8 shadow-2xl scale-100 z-10 transition-transform duration-300">
            <button 
              onClick={() => setActiveModal(null)}
              className="custom-modal-close-btn absolute top-5.5 right-5.5 w-8 h-8 rounded-full bg-white/5 hover:bg-[#ff007f]/15 border border-white/8 hover:border-[#ff007f]/30 text-white/60 hover:text-[#ff007f] flex items-center justify-center cursor-pointer transition-all duration-200"
              aria-label="Close"
            >
              <X size={15} />
            </button>

            {activeModal === "privacy" && (
              <>
                <div className="custom-modal-header mb-5 border-b border-white/8 pb-3">
                  <h2 className="text-xl font-bold font-display text-white">Privacy Policy / গোপনীয়তা নীতি</h2>
                </div>
                <div className="custom-modal-content text-left mb-6 max-h-72 overflow-y-auto pr-2">
                  <p className="font-primary text-[14.5px] leading-relaxed text-white/80">
                    লাইভ টিভি চ্যানেলে (Live TV Channel) আমরা আপনার গোপনীয়তাকে অত্যন্ত গুরুত্ব সহকারে মূল্যায়ন করি। আমরা আপনার কোনো ব্যক্তিগত তথ্য বা ব্যবহারকারীর ডেটা সংগ্রহ বা সংরক্ষণ করি না। আপনার বুকমার্ক করা পছন্দের চ্যানেল তালিকার মতো তথ্য সম্পূর্ণ সুরক্ষিতভাবে শুধুমাত্র আপনার ব্যবহার করা স্থানীয় ডিভাইসের ব্রাউজার <code className="bg-white/10 px-1 rounded text-xs select-all">localStorage</code>-এ সংরক্ষিত থাকে।
                  </p>
                </div>
                <div className="custom-modal-footer flex justify-end">
                  <button onClick={() => setActiveModal(null)} className="custom-modal-btn bg-gradient-to-br from-[#ff007f] to-[#9b51e0] text-white hover:scale-103 shadow-[0_6px_18px_rgba(255,0,127,0.35)] py-2.5 px-7 rounded-[14.5px] font-semibold text-sm cursor-pointer duration-300 transition-all font-display">Got It</button>
                </div>
              </>
            )}

            {activeModal === "terms" && (
              <>
                <div className="custom-modal-header mb-5 border-b border-white/8 pb-3">
                  <h2 className="text-xl font-bold font-display text-white">Terms of Service / ব্যবহারের শর্তাবলী</h2>
                </div>
                <div className="custom-modal-content text-left mb-6 max-h-72 overflow-y-auto pr-2">
                  <p className="font-primary text-[14.5px] leading-relaxed text-white/80 font-medium">
                    রানিং লাইভ টিভি চ্যানেল অ্যাপ্লিকেশনে আপনাকে স্বাগত! আমাদের সকল স্ট্রিমিং সেবা সম্পূর্ণ বিনামূল্যে সাধারণ ইন্টারনেট লিঙ্ক ব্যবহারকারীদের জন্য উন্মুক্ত করা হয়েছে। এখানে প্রদর্শিত কোনো লাইভ মিডিয়া স্ট্রিম বা ভিডিও ফাইল আমরা আমাদের সার্ভারে হোস্ট, ট্রান্সমিট বা পরিচালনা করি না; সম্প্রচারিত সকল কন্টেন্ট ইন্টারনেটে উন্মুক্তভাবে ছড়িয়ে থাকা পাবলিকলি উপলব্ধ লিঙ্ক এবং ওয়েব রিসোর্স থেকে সংগৃহীত। কপিরাইট সংশ্লিষ্ট আইন সংক্রান্ত যেকোনো বিষয়ে আপনার স্থানীয় সম্প্রচার নীতি অনুসরণ করুন।
                  </p>
                </div>
                <div className="custom-modal-footer flex justify-end">
                  <button onClick={() => setActiveModal(null)} className="custom-modal-btn bg-gradient-to-br from-[#ff007f] to-[#9b51e0] text-white hover:scale-103 shadow-[0_6px_18px_rgba(255,0,127,0.35)] py-2.5 px-7 rounded-[14.5px] font-semibold text-sm cursor-pointer duration-300 transition-all font-display">Got It</button>
                </div>
              </>
            )}

            {activeModal === "disclaimer" && (
              <>
                <div className="custom-modal-header mb-5 flex items-center gap-3 border-b border-white/8 pb-3">
                  <AlertTriangle className="text-xl text-[#9b51e0] animate-[warningPulse_1.5s_infinite_alternate]" size={18} />
                  <h2 className="text-xl font-bold font-display text-white">দ্রষ্টব্য / Disclaimer</h2>
                </div>
                <div className="custom-modal-content text-left mb-6 pr-2 text-white/80">
                  <p className="font-primary text-[14.5px] leading-relaxed text-white/90 mb-4 font-normal">
                    এই প্ল্যাটফর্মের সকল স্ট্রিম লিংক ও সোর্স ইন্টারনেটে <strong>পাবলিকভাবে উপলব্ধ</strong> জায়গা থেকে সংগ্রহ করা হয়েছে। আমরা কোনো কন্টেন্ট <strong>হোস্ট, আপলোড বা মালিকানা দাবি করি না</strong> — শুধু পাবলিক লিংকগুলো একত্র ও যাচাই করি।
                  </p>
                  <p className="font-primary text-[12.5px] leading-relaxed text-white/50">
                    কোনো স্ট্রিম বা কন্টেন্টে কপিরাইট সংক্রান্ত আপত্তি থাকলে সরাসরি মূল সোর্সের সাথে যোগাযোগ করার জন্য অনুরোধ করা হলো। এই প্ল্যাটফর্মটি শুধুমাত্র ইন্টারনেটে থাকা পাবলিক লিঙ্কগুলো সহজে উপভোগ করার জন্য তৈরি করা হয়েছে।
                  </p>
                </div>
                <div className="custom-modal-footer">
                  <button onClick={handleDisclaimerAccept} className="w-full bg-[#9b51e0] hover:bg-[#a662e6] text-white text-sm font-semibold py-3 px-5 rounded-[14.5px] cursor-pointer shadow-[0_4px_15px_rgba(155,81,224,0.25)] transition-all duration-300 font-display">আমি বুঝেছি</button>
                </div>
              </>
            )}

            {activeModal === "warning" && (
              <>
                <div className="custom-modal-header mb-5 flex items-center gap-3 border-b border-white/8 pb-3">
                  <AlertTriangle className="text-xl text-[#fbbc05]" size={18} />
                  <h2 className="text-xl font-bold font-display text-white">নিরাপত্তা সতর্কতা / Mixed Content</h2>
                </div>
                <div className="custom-modal-content text-left mb-6 pr-2 text-white/80">
                  <p className="font-primary text-[14px] leading-relaxed text-white">
                    এই চ্যানেলটি HTTP স্ট্রিম ব্যবহার করে, যা আপনার ব্রাউজারের নিরাপত্তা নীতি (Mixed Content Blocking) এর কারণে সরাসরি ব্রাউজারে চালানো সম্ভব হচ্ছে না।
                  </p>
                  <div className="warning-methods mt-4 bg-white/3 border border-white/5 p-3.5 rounded-xl flex flex-col gap-2.5">
                    <p className="text-[13px] font-semibold text-white/80">চ্যানেলটি দেখতে নিচের পদ্ধতি অনুসরণ করুন:</p>
                    <div className="flex gap-2 text-xs text-white/60">
                      <span className="text-[#00f2fe] font-bold">পদ্ধতি ১:</span>
                      <span>পেজের URL বারে থাকা সাইট সেটিংস এ গিয়ে "Insecure Content" বা "Insecure content permission" অনুমতি প্রদান করুন এবং পেজ রিলোড করুন।</span>
                    </div>
                  </div>
                </div>
                <div className="custom-modal-footer flex justify-end">
                  <button onClick={() => setActiveModal(null)} className="custom-modal-btn bg-gradient-to-br from-[#ff007f] to-[#9b51e0] text-white hover:scale-103 shadow-[0_6px_18px_rgba(255,0,127,0.35)] py-2.5 px-7 rounded-[14.5px] font-semibold text-sm cursor-pointer duration-300 transition-all font-display">Got It</button>
                </div>
              </>
            )}

            {activeModal === "adminLogin" && (
              <>
                <div className="custom-modal-header mb-5 flex items-center gap-3 border-b border-white/8 pb-3">
                  <span className="text-xl">🔐</span>
                  <h2 className="text-xl font-bold font-display text-white">এডমিন প্যানেল লগইন / Admin Access</h2>
                </div>
                <div className="custom-modal-content text-left mb-6">
                  <p className="font-primary text-[14.5px] leading-relaxed text-white/80 mb-4">
                    প্লেলিস্ট ও লাইভ চ্যানেল ম্যানেজার অ্যাক্সেস করতে অনুগ্রহ করে সিকিউরিটি কোড বা পাসওয়ার্ডটি প্রদান করুন।
                  </p>
                  
                  <form onSubmit={(e) => {
                    e.preventDefault();
                    if (loginInputWord === "416737@") {
                      setAdminPassword("416737@");
                      localStorage.setItem("adminPassword", "416737@");
                      setActiveModal(null);
                      setCurrentCategory("Manage");
                      setSuccessMsg("এডমিন লগইন সফল হয়েছে! প্লেলিস্ট ম্যানেজার ওপেন করা হয়েছে।");
                    } else {
                      setLoginError("ভুল পাসওয়ার্ড! অনুগ্রহ করে সঠিক পাসওয়ার্ড প্রদান করুন।");
                    }
                  }} className="flex flex-col gap-4 select-none">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs text-white/50 tracking-wider">পাসওয়ার্ড টাইপ করুন</label>
                      <input 
                        type="password" 
                        placeholder="••••••••" 
                        value={loginInputWord}
                        onChange={(e) => {
                          setLoginInputWord(e.target.value);
                          setLoginError("");
                        }}
                        className="px-4 py-3 bg-white/4 border border-white/8 rounded-xl text-white outline-none w-full font-mono text-center text-lg tracking-widest focus:border-[#ff007f]/50"
                        required
                        autoFocus
                      />
                    </div>

                    {loginError && (
                      <div className="text-red-500 font-semibold text-xs flex items-center gap-1.5 bg-red-500/10 p-2.5 rounded-xl border border-red-500/15">
                        <AlertTriangle size={12} className="text-red-500 shrink-0" />
                        <span>{loginError}</span>
                      </div>
                    )}

                    <div className="custom-modal-footer flex gap-3 mt-2 justify-end">
                      <button 
                        type="button"
                        onClick={() => setActiveModal(null)} 
                        className="py-2.5 px-5 rounded-[12px] text-xs font-semibold bg-white/5 hover:bg-white/10 text-white/80 cursor-pointer duration-300"
                      >
                        বাতিল
                      </button>
                      <button 
                        type="submit" 
                        className="py-2.5 px-6 rounded-[12px] text-xs font-bold text-white bg-gradient-to-br from-[#ff007f] to-[#9b51e0] hover:shadow-[0_0_15px_rgba(255,0,127,0.4)] cursor-pointer hover:scale-105 duration-300 transition-all font-display shadow-lg"
                      >
                        প্রবেশ করুন
                      </button>
                    </div>
                  </form>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
