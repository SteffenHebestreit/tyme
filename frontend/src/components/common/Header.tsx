import { Link, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useApp } from '../../store/AppContext'
import { useAuth } from '../../contexts/AuthContext'

/**
 * Application header component with navigation and theme toggle.
 * 
 * Features:
 * - Modern futuristic branding with gradient logo
 * - Fixed position with glassmorphism backdrop blur
 * - Navigation links for authenticated users
 * - User menu with profile and logout options
 * - Theme toggle button (always dark theme)
 * - Purple-pink gradient accents
 * - Responsive design with mobile hamburger menu
 * 
 * @component
 * @returns {JSX.Element} Application header with navigation
 */
export default function Header() {
  const { t, i18n } = useTranslation('common')
  const { state, dispatch } = useApp()
  const { isAuthenticated, user, isAdmin, logout } = useAuth()
  const navigate = useNavigate()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)

  const toggleTheme = () => {
    dispatch({ type: 'SET_THEME', payload: state.theme === 'light' ? 'dark' : 'light' })
  }

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng)
    setUserMenuOpen(false)
    setMobileMenuOpen(false)
  }

  const closeMobileMenu = () => {
    setMobileMenuOpen(false)
  }

  const handleLogout = () => {
    // Close menus
    setUserMenuOpen(false)
    setMobileMenuOpen(false)
    
    // Call AuthContext logout (handles Keycloak logout and cleanup)
    logout()
  }
  
  return (
    <header className={`fixed top-0 w-full z-50 backdrop-blur-lg border-b ${
      state.theme === 'light'
        ? 'bg-white/80 border-purple-300/50'
        : 'bg-gray-900/80 border-purple-500/20'
    }`}>
      <div className="container mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          <Link to={isAuthenticated ? "/dashboard" : "/"} className="flex items-center space-x-2">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center p-1.5">
              <svg className="w-full h-full text-white" viewBox="310 315 420 380" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                <path d="M448.261414,528.247314 C406.684937,574.272095 365.349579,620.035278 324.076569,665.729492 C321.552979,663.913635 322.024200,662.095032 322.016846,660.520203 C321.939606,644.026917 321.968719,627.533081 321.859924,611.040100 C321.842926,608.462708 322.937012,606.653320 324.559082,604.860474 C350.150085,576.574280 375.765533,548.309753 401.264374,519.940552 C418.075500,501.236908 434.762085,482.420410 451.397491,463.560150 C458.079041,455.985016 457.837280,456.009186 465.752899,462.349213 C484.077606,477.026398 502.488708,491.596466 520.937195,506.118011 C526.098206,510.180481 527.529785,509.820587 531.732178,505.084717 C555.598450,478.188599 579.335388,451.178589 603.678528,424.706421 C618.780457,408.283875 633.482483,391.494202 648.455811,374.952423 C651.283386,371.828583 651.460449,369.335449 648.049316,366.612427 C643.625977,363.081421 639.357849,359.356628 634.986694,355.759247 C633.692566,354.694214 632.435486,353.667267 632.134827,351.954681 C633.478271,349.951599 635.590393,349.767914 637.424805,349.166046 C661.780151,341.174927 686.151062,333.231262 710.512878,325.259705 C715.927307,323.487976 717.201538,324.217224 716.560974,328.874298 C712.866882,355.734344 709.163391,382.593109 705.464111,409.452423 C705.307434,410.590118 705.415466,411.804840 704.455627,412.752258 C702.494263,413.504395 701.400208,411.956116 700.191895,410.937500 C695.990601,407.395752 691.696228,403.939972 687.751221,400.126770 C684.828247,397.301514 682.758179,397.269501 679.992920,400.380035 C668.487427,413.322449 656.766602,426.073059 645.196106,438.958191 C620.385498,466.587891 595.608337,494.247559 570.839417,521.914673 C558.953430,535.191467 546.995972,548.407959 535.340820,561.885193 C532.272278,565.433411 530.282898,566.475891 526.132019,563.143005 C506.784637,547.608337 487.183258,532.389404 467.628113,517.114685 C461.699127,512.483521 461.451294,512.599243 456.566254,518.451965 C453.899261,521.647339 451.191803,524.808899 448.261414,528.247314 z"/>
                <path d="M525.050293,445.000000 C525.049805,458.889099 525.049805,472.278198 525.049805,486.240143 C520.265808,484.856598 517.633606,482.266693 514.826904,480.085693 C502.596313,470.581573 490.520325,460.877716 478.244781,451.432831 C475.284882,449.155426 474.161469,446.724762 474.285065,442.970612 C474.514709,435.993988 474.120819,428.996613 473.980072,422.008026 C473.867340,416.409729 472.881500,415.414886 467.114716,415.409637 C444.801453,415.389313 422.488159,415.409210 400.174896,415.397095 C398.046722,415.395935 395.857178,415.787170 393.615784,414.602966 C393.705231,411.520111 396.097076,409.652924 397.649628,407.485382 C406.958405,394.489502 416.473297,381.641357 425.800415,368.658386 C427.723114,365.982056 429.874878,364.721283 433.269562,364.727081 C489.912048,364.823486 546.554688,364.813446 603.197266,364.849518 C604.971985,364.850647 606.904358,364.428345 608.406555,366.099213 C608.836121,368.330994 607.232239,369.775452 606.098511,371.305359 C595.884949,385.087433 585.549255,398.779449 575.409973,412.615631 C573.474670,415.256561 571.184387,416.020599 568.158508,416.001678 C555.997620,415.925507 543.832092,416.124664 531.676758,415.849030 C526.660706,415.735260 524.795532,417.551117 524.970276,422.511444 C525.228333,429.832825 525.045776,437.169708 525.050293,445.000000 z"/>
                <path d="M622.777100,588.000000 C622.727173,558.672119 623.055542,529.835449 622.380676,501.022217 C622.194519,493.074890 624.501221,487.735352 629.857483,482.192078 C642.581970,469.023468 654.597534,455.170959 666.954590,441.645081 C668.797974,439.627319 670.261841,437.057831 673.206421,436.156128 C675.308044,438.375885 674.918518,440.960632 674.903564,443.363647 C674.766296,465.344543 674.437134,487.324860 674.404785,509.305664 C674.324951,563.616455 674.329407,617.927490 674.448547,672.238098 C674.458313,676.688843 673.311523,678.493774 668.577637,678.403320 C655.418213,678.151672 642.246399,678.123047 629.088684,678.416382 C624.107422,678.527405 622.864197,676.560364 622.877258,671.984680 C622.956604,644.156738 622.832886,616.328308 622.777100,588.000000 z"/>
                <path d="M547.099365,648.953979 C547.066223,625.298096 547.076233,602.134766 546.956177,578.971985 C546.939697,575.792053 547.627502,573.156189 549.817139,570.778687 C564.938599,554.359619 579.998413,537.883789 595.094604,521.441467 C596.302002,520.126404 597.434692,518.563110 599.889587,518.880310 C601.815918,523.672791 601.038391,528.728821 600.817322,533.598694 C600.023254,551.091553 600.458252,568.585571 600.400269,586.077209 C600.303711,615.238953 600.330505,644.401733 600.485413,673.563049 C600.505310,677.313843 599.358948,678.562866 595.654419,678.517761 C581.325378,678.343262 566.991577,678.242920 552.664246,678.443787 C548.381653,678.503784 546.904053,676.811646 547.282288,672.914246 C548.042419,665.082153 547.030396,657.269714 547.099365,648.953979 z"/>
                <path d="M524.977173,589.478271 C525.008423,617.242249 524.911377,644.560730 525.126709,671.876709 C525.166199,676.882324 523.719421,678.559448 518.607178,678.429504 C505.789551,678.103821 492.956085,678.216614 480.132721,678.406433 C476.004974,678.467590 474.607178,676.967712 474.598755,672.888306 C474.521362,635.419800 474.272095,597.951599 474.164032,560.483093 C474.150818,555.909790 474.674072,551.334900 474.935394,546.982422 C477.252899,546.268127 478.420013,547.395203 479.542847,548.299377 C493.808350,559.786194 508.034912,571.321350 522.289307,582.822021 C524.302734,584.446533 524.807495,586.644653 524.977173,589.478271 z"/>
                <path d="M449.421204,549.716553 C450.526337,561.507568 449.909912,573.008423 449.958649,584.496887 C450.080902,613.317261 450.074829,642.138245 450.078522,670.958984 C450.079468,678.320618 450.008209,678.328491 442.478088,678.326111 C429.483643,678.321899 416.487427,678.181274 403.495819,678.368713 C399.297424,678.429260 397.574860,677.290527 397.605042,672.760620 C397.749268,651.104797 397.642700,629.446716 397.501221,607.790222 C397.477966,604.230164 398.548584,601.529724 401.015900,598.892761 C415.694092,583.205444 430.176727,567.335144 444.852600,551.645569 C445.885864,550.540955 446.550446,547.480469 449.421204,549.716553 z"/>
                <path d="M374.301697,654.000122 C374.278839,660.987366 374.234375,667.474731 374.246124,673.962036 C374.250549,676.402344 373.711395,678.277161 370.741730,678.263428 C358.436096,678.206482 346.130341,678.167053 333.824860,678.086365 C333.391144,678.083557 332.959869,677.712341 331.571014,677.071472 C344.630981,661.196350 358.999268,647.075012 372.453918,632.117554 C373.070099,632.367859 373.686279,632.618103 374.302460,632.868347 C374.302460,639.745667 374.302460,646.622925 374.301697,654.000122 z"/>
              </svg>
            </div>
            <span className={`text-2xl font-bold bg-gradient-to-r ${
              state.theme === 'light'
                ? 'from-purple-600 to-pink-600'
                : 'from-purple-400 to-pink-400'
            } bg-clip-text text-transparent`}>
              tyme
            </span>
          </Link>
          
          {/* Only show navigation when authenticated */}
          {isAuthenticated && (
            <nav className={`hidden md:flex space-x-6 ${
              state.theme === 'light' ? 'text-gray-700' : 'text-gray-300'
            }`}>
              <Link to="/clients" className={`${
                state.theme === 'light'
                  ? 'text-gray-700 hover:text-purple-600'
                  : 'text-gray-300 hover:text-purple-400'
              } transition-colors font-medium`}>
                {t('navigation.clients')}
              </Link>
              <Link to="/projects" className={`${
                state.theme === 'light'
                  ? 'text-gray-700 hover:text-purple-600'
                  : 'text-gray-300 hover:text-purple-400'
              } transition-colors font-medium`}>
                {t('navigation.projects')}
              </Link>
              <Link to="/time-entries" className={`${
                state.theme === 'light'
                  ? 'text-gray-700 hover:text-purple-600'
                  : 'text-gray-300 hover:text-purple-400'
              } transition-colors font-medium`}>
                {t('navigation.timeTracking')}
              </Link>
              <Link to="/finances" className={`${
                state.theme === 'light'
                  ? 'text-gray-700 hover:text-purple-600'
                  : 'text-gray-300 hover:text-purple-400'
              } transition-colors font-medium`}>
                {t('navigation.finances')}
              </Link>
              <Link to="/reports" className={`${
                state.theme === 'light'
                  ? 'text-gray-700 hover:text-purple-600'
                  : 'text-gray-300 hover:text-purple-400'
              } transition-colors font-medium`}>
                {t('navigation.reports')}
              </Link>
            </nav>
          )}

          <div className="flex items-center space-x-2">
            <button 
              onClick={toggleTheme}
              className={`p-2 rounded-lg transition-all ${
                state.theme === 'light'
                  ? 'text-purple-600 hover:text-purple-800 hover:bg-purple-100'
                  : 'text-purple-300 hover:text-purple-100 hover:bg-purple-500/10'
              }`}
              aria-label="Toggle theme">{
                state.theme === 'light' ? (
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12 21a9.753 9.753 0 009.002-5.998z" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
                </svg>
              )}
            </button>

            {/* User menu - Desktop (only show when authenticated) */}
            {isAuthenticated && (
              <div className="hidden md:block relative">
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className={`p-2 rounded-lg transition-all flex items-center space-x-2 ${
                    state.theme === 'light'
                      ? 'text-purple-600 hover:text-purple-800 hover:bg-purple-100'
                      : 'text-purple-300 hover:text-purple-100 hover:bg-purple-500/10'
                  }`}
                  aria-label="User menu"
                  aria-expanded={userMenuOpen}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </button>

                {/* Dropdown menu */}
                {userMenuOpen && (
                  <div className={`absolute right-0 mt-2 w-48 rounded-lg shadow-lg overflow-hidden border ${
                    state.theme === 'light'
                      ? 'bg-white border-purple-300/30'
                      : 'bg-gray-800 border-purple-500/20'
                  }`}>
                    {/* User info section */}
                    <div className={`px-4 py-3 border-b ${
                      state.theme === 'light'
                        ? 'border-purple-300/30 bg-purple-50'
                        : 'border-purple-500/20 bg-purple-500/5'
                    }`}>
                      <div className={`text-sm font-semibold ${
                        state.theme === 'light'
                          ? 'text-purple-700'
                          : 'text-purple-300'
                      }`}>
                        {user?.name || user?.username || user?.email || 'User'}
                      </div>
                      {user?.email && user?.email !== user?.username && (
                        <div className={`text-xs mt-0.5 ${
                          state.theme === 'light'
                            ? 'text-gray-500'
                            : 'text-gray-400'
                        }`}>
                          {user.email}
                        </div>
                      )}
                    </div>
                    
                    <Link
                      to="/profile"
                      className={`block px-4 py-3 transition-colors ${
                        state.theme === 'light'
                          ? 'text-gray-700 hover:bg-purple-100 hover:text-purple-600'
                          : 'text-gray-300 hover:bg-purple-500/10 hover:text-purple-400'
                      }`}
                      onClick={() => setUserMenuOpen(false)}
                    >
                      {t('navigation.profile')}
                    </Link>
                    <Link
                      to="/config"
                      className={`block px-4 py-3 transition-colors ${
                        state.theme === 'light'
                          ? 'text-gray-700 hover:bg-purple-100 hover:text-purple-600'
                          : 'text-gray-300 hover:bg-purple-500/10 hover:text-purple-400'
                      }`}
                      onClick={() => setUserMenuOpen(false)}
                    >
                      {t('navigation.settings')}
                    </Link>
                    
                    {isAdmin && (
                      <Link
                        to="/system-admin"
                        className={`block px-4 py-3 transition-colors ${
                          state.theme === 'light'
                            ? 'text-gray-700 hover:bg-purple-100 hover:text-purple-600'
                            : 'text-gray-300 hover:bg-purple-500/10 hover:text-purple-400'
                        }`}
                        onClick={() => setUserMenuOpen(false)}
                      >
                        System Admin
                      </Link>
                    )}
                    
                    <div className={`border-t ${
                      state.theme === 'light'
                        ? 'border-purple-300/30'
                        : 'border-purple-500/20'
                    }`}>
                      <div className={`px-4 py-2 text-xs font-semibold ${
                        state.theme === 'light'
                          ? 'text-gray-500'
                          : 'text-gray-400'
                      }`}>
                        {t('language.title')}
                      </div>
                      <button
                        onClick={() => changeLanguage('en')}
                        className={`w-full text-left px-4 py-2 transition-colors flex items-center justify-between ${
                          i18n.language === 'en'
                            ? state.theme === 'light'
                              ? 'bg-purple-100 text-purple-700 font-medium'
                              : 'bg-purple-500/20 text-purple-300 font-medium'
                            : state.theme === 'light'
                            ? 'text-gray-700 hover:bg-purple-50 hover:text-purple-600'
                            : 'text-gray-300 hover:bg-purple-500/10 hover:text-purple-400'
                        }`}
                      >
                        <span>English</span>
                        {i18n.language === 'en' && (
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                      </button>
                      <button
                        onClick={() => changeLanguage('de')}
                        className={`w-full text-left px-4 py-2 transition-colors flex items-center justify-between ${
                          i18n.language === 'de'
                            ? state.theme === 'light'
                              ? 'bg-purple-100 text-purple-700 font-medium'
                              : 'bg-purple-500/20 text-purple-300 font-medium'
                            : state.theme === 'light'
                            ? 'text-gray-700 hover:bg-purple-50 hover:text-purple-600'
                            : 'text-gray-300 hover:bg-purple-500/10 hover:text-purple-400'
                        }`}
                      >
                        <span>Deutsch</span>
                        {i18n.language === 'de' && (
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                      </button>
                    </div>
                    
                    <div className={`border-t ${
                      state.theme === 'light'
                        ? 'border-purple-300/30'
                        : 'border-purple-500/20'
                    }`}>
                      <button
                        onClick={handleLogout}
                        className={`w-full text-left px-4 py-3 transition-colors ${
                          state.theme === 'light'
                            ? 'text-gray-700 hover:bg-purple-100 hover:text-purple-600'
                            : 'text-gray-300 hover:bg-purple-500/10 hover:text-purple-400'
                        }`}
                      >
                        {t('buttons.logout')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Mobile menu button (only show when authenticated) */}
            {isAuthenticated && (
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className={`md:hidden p-2 rounded-lg transition-all ${
                  state.theme === 'light'
                    ? 'text-purple-600 hover:text-purple-800 hover:bg-purple-100'
                    : 'text-purple-300 hover:text-purple-100 hover:bg-purple-500/10'
                }`}
                aria-label="Toggle mobile menu"
                aria-expanded={mobileMenuOpen}
              >
                {mobileMenuOpen ? (
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                  </svg>
                )}
              </button>
            )}

            {/* Login button - only show when not authenticated */}
            {!isAuthenticated && (
              <Link
                to="/login"
                className={`relative group p-2 rounded-lg transition-all ${
                  state.theme === 'light'
                    ? 'text-purple-600 hover:text-purple-800 hover:bg-purple-100'
                    : 'text-purple-300 hover:text-purple-100 hover:bg-purple-500/10'
                }`}
                aria-label={t('buttons.login')}
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
                </svg>
                {/* Tooltip */}
                <span className={`absolute right-0 top-full mt-2 px-2 py-1 text-xs font-medium rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none ${
                  state.theme === 'light'
                    ? 'bg-gray-800 text-white'
                    : 'bg-gray-700 text-white'
                }`}>
                  {t('tooltips.login')}
                </span>
              </Link>
            )}
          </div>
        </div>

        {/* Mobile menu */}
        {isAuthenticated && mobileMenuOpen && (
          <nav className={`md:hidden mt-4 pb-4 space-y-2 border-t pt-4 ${
            state.theme === 'light'
              ? 'border-purple-300/30'
              : 'border-purple-500/20'
          }`}>
            <Link 
              to="/clients" 
              className={`block px-4 py-3 rounded-lg transition-all font-medium ${
                state.theme === 'light'
                  ? 'text-gray-700 hover:text-purple-600 hover:bg-purple-100'
                  : 'text-gray-300 hover:text-purple-400 hover:bg-purple-500/10'
              }`}
              onClick={closeMobileMenu}
            >
              {t('navigation.clients')}
            </Link>
            <Link 
              to="/projects" 
              className={`block px-4 py-3 rounded-lg transition-all font-medium ${
                state.theme === 'light'
                  ? 'text-gray-700 hover:text-purple-600 hover:bg-purple-100'
                  : 'text-gray-300 hover:text-purple-400 hover:bg-purple-500/10'
              }`}
              onClick={closeMobileMenu}
            >
              {t('navigation.projects')}
            </Link>
            <Link 
              to="/time-entries" 
              className={`block px-4 py-3 rounded-lg transition-all font-medium ${
                state.theme === 'light'
                  ? 'text-gray-700 hover:text-purple-600 hover:bg-purple-100'
                  : 'text-gray-300 hover:text-purple-400 hover:bg-purple-500/10'
              }`}
              onClick={closeMobileMenu}
            >
              {t('navigation.timeTracking')}
            </Link>
            <Link 
              to="/finances" 
              className={`block px-4 py-3 rounded-lg transition-all font-medium ${
                state.theme === 'light'
                  ? 'text-gray-700 hover:text-purple-600 hover:bg-purple-100'
                  : 'text-gray-300 hover:text-purple-400 hover:bg-purple-500/10'
              }`}
              onClick={closeMobileMenu}
            >
              {t('navigation.finances')}
            </Link>
            <Link 
              to="/reports" 
              className={`block px-4 py-3 rounded-lg transition-all font-medium ${
                state.theme === 'light'
                  ? 'text-gray-700 hover:text-purple-600 hover:bg-purple-100'
                  : 'text-gray-300 hover:text-purple-400 hover:bg-purple-500/10'
              }`}
              onClick={closeMobileMenu}
            >
              {t('navigation.reports')}
            </Link>
            
            {/* User menu items */}
            <div className={`border-t pt-2 ${
              state.theme === 'light'
                ? 'border-purple-300/30'
                : 'border-purple-500/20'
            }`}>
              <Link 
                to="/profile" 
                className={`block px-4 py-3 rounded-lg transition-all font-medium ${
                  state.theme === 'light'
                    ? 'text-gray-700 hover:text-purple-600 hover:bg-purple-100'
                    : 'text-gray-300 hover:text-purple-400 hover:bg-purple-500/10'
                }`}
                onClick={closeMobileMenu}
              >
                {t('navigation.profile')}
              </Link>
              <Link 
                to="/config" 
                className={`block px-4 py-3 rounded-lg transition-all font-medium ${
                  state.theme === 'light'
                    ? 'text-gray-700 hover:text-purple-600 hover:bg-purple-100'
                    : 'text-gray-300 hover:text-purple-400 hover:bg-purple-500/10'
                }`}
                onClick={closeMobileMenu}
              >
                {t('navigation.settings')}
              </Link>
              
              {isAdmin && (
                <Link 
                  to="/system-admin" 
                  className={`block px-4 py-3 rounded-lg transition-all font-medium ${
                    state.theme === 'light'
                      ? 'text-gray-700 hover:text-purple-600 hover:bg-purple-100'
                      : 'text-gray-300 hover:text-purple-400 hover:bg-purple-500/10'
                  }`}
                  onClick={closeMobileMenu}
                >
                  System Admin
                </Link>
              )}
            </div>
            <button
              onClick={handleLogout}
              className={`w-full text-left px-4 py-3 rounded-lg transition-all font-medium border-t ${
                state.theme === 'light'
                  ? 'text-gray-700 hover:text-purple-600 hover:bg-purple-100 border-purple-300/30'
                  : 'text-gray-300 hover:text-purple-400 hover:bg-purple-500/10 border-purple-500/20'
              }`}
            >
              {t('buttons.logout')}
            </button>
          </nav>
        )}
      </div>
    </header>
  )
}
